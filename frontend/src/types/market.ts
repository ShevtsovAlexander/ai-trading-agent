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

export const INTERVAL_LABELS: Record<Interval, string> = {
    '1m': '1м',
    '5m': '5м',
    '15m': '15м',
    '1h': '1ч',
    '4h': '4ч',
    '1d': '1д',
};

// Диапазоны по возрастанию длины — порядок вкладок графика
export const RANGE_ORDER: Range[] = ['1h', '4h', '12h', '24h', '2w', '1m', '3m', '1y'];

// Диапазон после смены интервала: допустимый — остаётся; иначе — ближайший
// по порядку допустимый. Допустимые для интервала идут сплошным отрезком
// RANGE_ORDER, недопустимый лежит по одну его сторону — ничьих нет
// (24ч на 1д → 2нед, 3мес на 5м → 2нед, 1г на 1м → 24ч).
export const nearestAllowed = (range: Range, interval: Interval): Range => {
    if (isAllowed(range, interval)) return range;
    const from = RANGE_ORDER.indexOf(range);
    let best = range;
    let bestDist = Infinity;
    RANGE_ORDER.forEach((r, i) => {
        const dist = Math.abs(i - from);
        if (isAllowed(r, interval) && dist < bestDist) {
            best = r;
            bestDist = dist;
        }
    });
    return best;
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

// Свечей в куске истории (с разогревом бэкенда — 2 страницы Binance)
export const HISTORY_CHUNK = 1500;

// GET /market/candles/:coinId/history — кусок левее before, ряды тем же
// расчётом, что MarketSeries; series[i].t === candles[i].t
export interface HistoryChunk {
    coinId: string;
    market: string;
    interval: Interval;
    before: number; // openTime, исключительно: все свечи t < before
    candles: Candle[]; // ≤ HISTORY_CHUNK, по возрастанию
    series: SeriesPoint[];
    complete: boolean; // true — левее свечей у Binance нет (листинг пары)
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
