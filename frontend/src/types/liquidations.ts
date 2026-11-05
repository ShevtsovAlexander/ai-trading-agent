// ---------------------------------------------------------------------------
// Ликвидации (TASK-0015). Зеркало backend/src/liquidations/liquidations.types.ts
// — формы ответа меняются в обоих файлах вместе.
// ---------------------------------------------------------------------------
import type { Exchange } from './derivatives';

export type LiqPeriod = '1d' | '1m' | '1y';

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

// GET /liquidations/:coinId?period=
export interface Liquidations {
    coinId: string;
    market: string;
    period: LiqPeriod;
    stepMs: number;
    exchanges: ({ exchange: Exchange } | { exchange: Exchange; error: string })[]; // всегда binance, okx, bybit
    last24h: Last24h;
    points: LiqPoint[]; // полная сетка, по возрастанию t
}
