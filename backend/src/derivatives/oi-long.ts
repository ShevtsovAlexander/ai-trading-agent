import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Candle } from '../market/market.types';
import { Exchange, OiPoint } from './derivatives.types';

// OI 1Г и «Всё» по Coinalyze (TASK-0017): дневной OI USDT-контрактов трёх бирж в
// USD, одним запросом на монету. Замер — research TASK-0017 «Замер данных»
const HISTORY_URL = 'https://api.coinalyze.net/v1/open-interest-history';
const SOURCE = 'Coinalyze';
const DAY_MS = 86_400_000;
// Первая метка в USD у всех девяти рядов (3 биржи × 3 монеты), research
export const OI_LONG_FROM = Date.UTC(2022, 8, 30);
export const OI_YEAR_POINTS = 365;
// Порядок сложения — контракт: от него зависит последний бит суммы (критик 17.1)
const ORDER: Exchange[] = ['binance', 'okx', 'bybit'];

export interface OiBar {
  t: number; // метка Coinalyze: открытие дня, мс UTC
  usd: number; // OI на конец дня, USD
}

// Числа Coinalyze — числа JSON: `num` из sources.ts не подходит (как ликвидации)
const seconds = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${SOURCE}: поле t не время (${String(value)})`);
  }
  return value * 1000;
};

const usd = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${SOURCE}: поле c не сумма OI (${String(value)})`);
  }
  return value;
};

// Ответ → ряды по символам. Символа нет в ответе — его нет в словаре: отказ одной
// биржи, а не запроса. Чужой символ, метка не на дне, дубль метки, порча — ошибка.
// OI 0 — пропуск дня (дыра), а не отказ биржи: как строка с 0 у истории 30 дней
export function parseOiHistory(
  raw: unknown,
  symbols: string[],
): Map<string, OiBar[]> {
  if (!Array.isArray(raw)) throw new Error(`${SOURCE}: ответ не массив`);
  const out = new Map<string, OiBar[]>();
  for (const row of raw as Record<string, unknown>[]) {
    const symbol = row?.symbol;
    if (typeof symbol !== 'string' || !symbols.includes(symbol)) {
      throw new Error(`${SOURCE}: чужой символ ${String(symbol)}`);
    }
    if (!Array.isArray(row.history)) {
      throw new Error(`${SOURCE}: ${symbol} без history`);
    }
    const seen = new Set<number>();
    const bars: OiBar[] = [];
    for (const p of row.history as Record<string, unknown>[]) {
      const t = seconds(p?.t);
      if (t % DAY_MS !== 0) {
        throw new Error(`${SOURCE}: метка ${t} не на начале дня`);
      }
      if (seen.has(t)) throw new Error(`${SOURCE}: дубль метки ${t}`);
      seen.add(t);
      const value = usd(p?.c);
      if (value > 0) bars.push({ t, usd: value });
    }
    out.set(symbol, bars);
  }
  return out;
}

// from, to — мс; Coinalyze ждёт целые секунды. Ключ — только заголовком; ошибки
// сети не ловит: их переводит вызывающий
export async function fetchOiHistoryCoinalyze(
  http: HttpService,
  key: string,
  symbols: string[],
  from: number,
  to: number,
): Promise<Map<string, OiBar[]>> {
  const res = await firstValueFrom(
    http.get<unknown>(HISTORY_URL, {
      headers: { api_key: key },
      params: {
        symbols: symbols.join(','),
        interval: 'daily',
        from: Math.floor(from / 1000),
        to: Math.floor(to / 1000),
        convert_to_usd: 'true',
      },
    }),
  );
  return parseOiHistory(res.data, symbols);
}

export interface OiLongInput {
  period: '1y' | 'all';
  now: number;
  // Только ответившие биржи; нет ключа — биржа выпадает из всех точек
  rows: Partial<Record<Exchange, OiBar[]>>;
  spot: Candle[] | null; // закрытые дневные свечи спота, t — открытие
}

// Ряд на моментах снимка, как история 30 дней (oi-history.ts). Бар `D 00:00` —
// значение на конец дня D, то есть момент `D + сутки` (research: так совпадает с
// биржами, медиана 0,01 %). Момент позже now — живой текущий день, отброшен.
// Точка — только где есть все учтённые биржи, иначе дыра; бары раньше
// OI_LONG_FROM не берутся. Цена — close свечи,
// открытой в момент − сутки: она закрылась ровно в момент
export function buildOiLongSeries(input: OiLongInput): OiPoint[] {
  const present = ORDER.filter((e) => input.rows[e] !== undefined);
  if (present.length === 0) return [];

  const values = new Map<Exchange, Map<number, number>>();
  for (const exchange of present) {
    const m = new Map<number, number>();
    for (const bar of input.rows[exchange]!) {
      const moment = bar.t + DAY_MS;
      // Раньше OI_LONG_FROM в USD есть не у всех девяти рядов (research)
      if (bar.t >= OI_LONG_FROM && moment <= input.now) m.set(moment, bar.usd);
    }
    values.set(exchange, m);
  }
  const closes = new Map((input.spot ?? []).map((c) => [c.t, c.close]));

  const points: OiPoint[] = [];
  const moments = [...values.get(present[0])!.keys()].sort((a, b) => a - b);
  for (const t of moments) {
    if (!present.every((e) => values.get(e)!.has(t))) continue;
    const byExchange: Partial<Record<Exchange, number>> = {};
    let totalUsd = 0;
    for (const exchange of present) {
      const v = values.get(exchange)!.get(t)!;
      byExchange[exchange] = v;
      totalUsd += v;
    }
    points.push({
      t,
      totalUsd,
      byExchange,
      price: closes.get(t - DAY_MS) ?? null,
    });
  }
  return input.period === '1y' ? points.slice(-OI_YEAR_POINTS) : points;
}
