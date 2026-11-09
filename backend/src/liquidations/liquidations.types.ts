// График ликвидаций (TASK-0015): лонги и шорты по времени, сумма USDT-контрактов
// Binance + OKX + Bybit по Coinalyze. Источник видит не все ликвидации
// (сверка с OKX — docs/RESEARCH.md). Зеркало — frontend/src/types/liquidations.ts,
// формы меняются вместе.
import { Exchange } from '../derivatives/derivatives.types';

export const LIQUIDATION_SYMBOLS: Record<string, Record<Exchange, string>> = {
  bitcoin: {
    binance: 'BTCUSDT_PERP.A',
    okx: 'BTCUSDT_PERP.3',
    bybit: 'BTCUSDT.6',
  },
  ethereum: {
    binance: 'ETHUSDT_PERP.A',
    okx: 'ETHUSDT_PERP.3',
    bybit: 'ETHUSDT.6',
  },
  solana: {
    binance: 'SOLUSDT_PERP.A',
    okx: 'SOLUSDT_PERP.3',
    bybit: 'SOLUSDT.6',
  },
};

export type LiqPeriod = '1d' | '1m' | '1y';

// Шаг и число закрытых свечей каждого периода (план TASK-0015, «Контракты»)
export const LIQ_PERIODS: Record<
  LiqPeriod,
  { interval: string; stepMs: number; bars: number }
> = {
  '1d': { interval: '15min', stepMs: 15 * 60_000, bars: 96 },
  '1m': { interval: '1hour', stepMs: 3_600_000, bars: 720 },
  '1y': { interval: 'daily', stepMs: 86_400_000, bars: 365 },
};

// Свеча считается закрытой через минуту после конца: и граница окна, и кэш
export const LIQ_CLOSE_MARGIN_MS = 60_000;
export const LIQ_ERROR_TTL_MS = 60_000;
export const LIQ_RETRY_AFTER_DEFAULT_S = 60;
export const LIQ_TIMEOUT_MS = 10_000;

export interface LiqPoint {
  t: number; // открытие свечи, мс UTC, на сетке шага
  // null — ни одна биржа не отдала запись за эту свечу: затишье или сбой
  // источника, различить нельзя. Не ноль
  longUsd: number | null;
  shortUsd: number | null;
}

export interface Last24h {
  longUsd: number;
  shortUsd: number;
  from: number; // открытие первой свечи, мс
  to: number; // конец последней свечи, мс
}

// Ответ GET /liquidations/:coinId?period=
export interface Liquidations {
  coinId: string;
  market: string;
  period: LiqPeriod;
  stepMs: number;
  exchanges: ({ exchange: Exchange } | { exchange: Exchange; error: string })[]; // всегда binance, okx, bybit
  last24h: Last24h;
  points: LiqPoint[]; // полная сетка, по возрастанию t
}
