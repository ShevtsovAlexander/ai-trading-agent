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
// значение незакрытого периода, её момент позже now; research TASK-0008
// «Дозамер»). Окно — моменты (now − 30 дн, now]. Точка — только там, где
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
  if (input.okx) sources.push(['okx', byMoment(input.okx, step, (r) => r.usd)]);
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
