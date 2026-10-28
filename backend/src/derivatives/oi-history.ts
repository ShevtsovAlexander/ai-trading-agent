import { Candle } from '../market/market.types';
import { Exchange, OiPoint, OiStep } from './derivatives.types';
import { OiRow } from './sources';

export const OI_WINDOW_DAYS = 30; // окно графика — решение человека (PRD TASK-0008)
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const OI_STEP_MS: Record<OiStep, number> = {
  '1d': DAY_MS,
  '1h': HOUR_MS,
};
// Строка OKX становится окончательной не сразу: самая свежая — живое
// значение, предыдущая меняется ещё раз уже после появления новой и
// устаивается к ~3 мин после момента; копии ответа бывают устаревшими
// (замер T4, граница 15:00). Момент OKX берётся через 10 мин, с запасом
export const OKX_SETTLE_MS = 10 * 60_000;

export interface OiSeriesInput {
  step: OiStep;
  now: number;
  // null — биржа не ответила: выпадает из суммы всех точек, а не отдельных
  binance: OiRow[] | null;
  okx: OiRow[] | null;
  // Bybit — в монетах, без своей mark-цены его не перевести в USD: упала
  // цена — Bybit целиком null (план TASK-0008, «Контракты»)
  bybit: { rows: OiRow[]; marks: Map<number, number> } | null;
  spot: Candle[] | null; // закрытые свечи шага, t — открытие
}

// Ряд OI на сетке моментов. Метка биржи → момент снимка: Binance и Bybit —
// снимок в метке, OKX — значение в метке + шаг (его свежая строка — живое
// значение и отбрасывается, как и моменты моложе OKX_SETTLE_MS; research
// TASK-0008 «Дозамер», замер T4). Окно — моменты (now − 30 дн, now]. Точка — только там, где
// есть все учтённые биржи: иначе дыра, а не сумма по двум (PRD 2). Цена —
// close спот-свечи, открытой в t − шаг: она закрылась ровно в t.
export function buildOiSeries(input: OiSeriesInput): OiPoint[] {
  const step = OI_STEP_MS[input.step];
  const { now } = input;
  const from = now - OI_WINDOW_DAYS * DAY_MS;

  const byMoment = (
    rows: OiRow[],
    shift: number,
    value: (r: OiRow) => number | undefined,
  ) => {
    const m = new Map<number, number>();
    for (const r of rows) {
      const v = value(r);
      if (v !== undefined) m.set(r.t + shift, v);
    }
    return m;
  };

  const sources: [Exchange, Map<number, number>][] = [];
  if (input.binance)
    sources.push(['binance', byMoment(input.binance, 0, (r) => r.usd)]);
  if (input.okx) {
    // Самая свежая строка OKX не окончательная никогда — отбрасывается,
    // остальные — только если момент старше OKX_SETTLE_MS
    const newest = Math.max(...input.okx.map((r) => r.t));
    const settled = input.okx.filter(
      (r) => r.t !== newest && r.t + step <= now - OKX_SETTLE_MS,
    );
    sources.push(['okx', byMoment(settled, step, (r) => r.usd)]);
  }
  if (input.bybit) {
    const { marks } = input.bybit;
    sources.push([
      'bybit',
      byMoment(input.bybit.rows, 0, (r) => {
        const mark = marks.get(r.t);
        return r.coin === undefined || mark === undefined
          ? undefined
          : r.coin * mark;
      }),
    ]);
  }
  if (sources.length === 0) return [];

  const closes = new Map((input.spot ?? []).map((c) => [c.t, c.close]));
  // Кандидаты — моменты первой учтённой биржи; остальные обязаны совпасть
  const moments = [...sources[0][1].keys()]
    .filter((t) => t > from && t <= now)
    .sort((a, b) => a - b);

  const points: OiPoint[] = [];
  for (const t of moments) {
    const byExchange: Partial<Record<Exchange, number>> = {};
    let totalUsd = 0;
    let complete = true;
    for (const [exchange, values] of sources) {
      const v = values.get(t);
      if (v === undefined) {
        complete = false;
        break;
      }
      byExchange[exchange] = v;
      totalUsd += v;
    }
    if (!complete) continue;
    points.push({
      t,
      totalUsd,
      byExchange,
      price: closes.get(t - step) ?? null,
    });
  }
  return points;
}
