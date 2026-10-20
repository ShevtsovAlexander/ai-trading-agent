export interface PriceSnapshot {
    id: number;
    coinId: string;
    price: number;
    createdAt: string;
}

// Строка снимка рынка, как её отдаёт бэкенд: индикаторы плоско, как в БД.
// Вердиктных полей больше нет — ни решения, ни уверенности, ни риска.
export interface MarketSnapshot {
    id: number;
    market: string;
    coinId: string;
    currentPrice: number;
    previousPrice: number | null;
    movingAverage: number | null;
    ema9: number | null;
    ema21: number | null;
    rsi: number | null;
    macdValue: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    bbUpper: number | null;
    bbMiddle: number | null;
    bbLower: number | null;
    bbBandwidth: number | null;
    trend: 'up' | 'down' | 'flat';
    createdAt: string;
}

// Снимок с AI-комментарием. aiComment необязателен намеренно: его отдают
// GET /market/snapshot/:coinId и POST /market/refresh, а GET /market/history
// — нет (гонять модель на 50 строк незачем). Поэтому строка истории
// подходит под этот же тип, и союз двух форм не нужен.
export interface MarketState extends MarketSnapshot {
    aiComment?: string | null;
}

export interface MarketRefreshDto {
    market: string;
    coinId: string;
}

// ---------------------------------------------------------------------------
// Свечи Binance (TASK-0004). Зеркало backend/src/market/market.types.ts —
// интервалы, диапазоны и границы меняются в обоих файлах вместе.
// ---------------------------------------------------------------------------

export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type Range = '1h' | '4h' | '12h' | '24h' | '2w' | '1m' | '3m' | '1y';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const INTERVAL_MS: Record<Interval, number> = {
    '1m': MINUTE,
    '5m': 5 * MINUTE,
    '15m': 15 * MINUTE,
    '1h': HOUR,
    '4h': 4 * HOUR,
    '1d': DAY,
};

// Месяц — 30 дней, год — 365: диапазон графика, не календарь
export const RANGE_MS: Record<Range, number> = {
    '1h': HOUR,
    '4h': 4 * HOUR,
    '12h': 12 * HOUR,
    '24h': DAY,
    '2w': 14 * DAY,
    '1m': 30 * DAY,
    '3m': 90 * DAY,
    '1y': 365 * DAY,
};

export const MAX_CANDLES = 5000;
export const MIN_CANDLES = 12;

// Недопустимую комбинацию бэкенд отвергает 400 — фронт гасит кнопку заранее
// (24ч×5м = 288 — да, 3мес×5м = 25 920 — нет, 4ч×1ч = 4 — нет)
export const isAllowed = (range: Range, interval: Interval): boolean => {
    const count = RANGE_MS[range] / INTERVAL_MS[interval];
    return count >= MIN_CANDLES && count <= MAX_CANDLES;
};

// t — время открытия свечи (openTime, мс)
export interface Candle {
    t: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// Индикаторы на закрытии свечи t; null — периоду не хватило свечей
export interface SeriesPoint {
    t: number;
    close: number;
    ema9: number | null;
    ema21: number | null;
    rsi: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    bbUpper: number | null;
    bbMiddle: number | null;
    bbLower: number | null;
    bbBandwidth: number | null; // в процентах
}

// GET /market/candles/:coinId — series[i].t === candles[i].t
export interface MarketSeries {
    coinId: string;
    market: string;
    interval: Interval;
    range: Range;
    candles: Candle[];
    series: SeriesPoint[];
}

// GET /market/view/:coinId — последняя закрытая свеча интервала
export interface MarketView {
    coinId: string;
    market: string;
    interval: Interval;
    closedAt: number; // closeTime последней закрытой свечи, мс
    price: number;
    previousPrice: number;
    ma5: number | null;
    trend: 'up' | 'down' | 'flat';
    latest: SeriesPoint;
    recent: SeriesPoint[]; // 5 последних, старые → новые
    aiComment: string | null;
}
