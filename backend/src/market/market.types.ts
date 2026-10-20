// Свеча Binance в форме, с которой работает дашборд. t — время открытия
// свечи (openTime, мс): по нему строится ось графика и ключи кэша.
export interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Interval/Range, INTERVAL_MS/RANGE_MS, MIN/MAX_CANDLES, isAllowed и формы
// ответов продублированы во frontend/src/types/market.ts — меняются вместе.
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

export const MAX_CANDLES = 5000; // свечей в диапазоне, без разогрева
export const MIN_CANDLES = 12; // график из 1–6 точек бессмыслен
// Свечей слева от диапазона для разогрева индикаторов. Остаток затравки —
// вес × её ошибка: на 1d ошибка EMA26 — тысячи $, и при 200 свечах карточка
// расходилась с графиком на 0.01 (замер BTC 1d, критик T3). При 500 вес
// (25/27)^500 ≈ 2·10⁻¹⁷ — ниже округления на любом интервале.
export const WARMUP = 500;

// Комбинация допустима, если свечей в диапазоне от MIN_CANDLES до
// MAX_CANDLES (24ч×5м = 288 — да, 3мес×5м = 25 920 — нет, 4ч×1ч = 4 — нет)
export const isAllowed = (range: Range, interval: Interval): boolean => {
  const count = RANGE_MS[range] / INTERVAL_MS[interval];
  return count >= MIN_CANDLES && count <= MAX_CANDLES;
};

// Монеты дашборда: только пары Binance — свечей у CoinGecko нет
export const COINS: Record<string, { symbol: string; market: string }> = {
  bitcoin: { symbol: 'BTCUSDT', market: 'BTC/USDT' },
  ethereum: { symbol: 'ETHUSDT', market: 'ETH/USDT' },
  solana: { symbol: 'SOLUSDT', market: 'SOL/USDT' },
};

// Точка ряда индикаторов на закрытии свечи t. null — периоду не хватило
// свечей; значения округлены до 2 знаков, close — цена Binance как есть.
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

export interface MarketSeries {
  coinId: string;
  market: string;
  interval: Interval;
  range: Range;
  candles: Candle[];
  series: SeriesPoint[]; // series[i].t === candles[i].t
}

export interface MarketView {
  coinId: string;
  market: string;
  interval: Interval;
  closedAt: number; // closeTime последней закрытой свечи
  price: number;
  previousPrice: number;
  ma5: number | null;
  trend: 'up' | 'down' | 'flat';
  latest: SeriesPoint; // последняя закрытая свеча
  recent: SeriesPoint[]; // 5 последних закрытых, старые → новые (вход AI)
  aiComment: string | null;
}
