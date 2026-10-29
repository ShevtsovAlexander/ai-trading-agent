// Символы бессрочных USDT-фьючерсов по coinId — те же ключи, что COINS
// (market/market.types.ts): у Binance и Bybit символ как у спота Binance,
// у OKX — свой формат инструмента (research TASK-0007, «Open interest»).
export const DERIVATIVE_SYMBOLS: Record<
  string,
  { binance: string; okx: string; bybit: string }
> = {
  bitcoin: { binance: 'BTCUSDT', okx: 'BTC-USDT-SWAP', bybit: 'BTCUSDT' },
  ethereum: { binance: 'ETHUSDT', okx: 'ETH-USDT-SWAP', bybit: 'ETHUSDT' },
  solana: { binance: 'SOLUSDT', okx: 'SOL-USDT-SWAP', bybit: 'SOLUSDT' },
};

export type Exchange = 'binance' | 'okx' | 'bybit';

// Выплата funding из истории: t — fundingTime (мс), rate — доля (0.0001 = 0,01 %)
export interface FundingPayment {
  t: number;
  rate: number;
}

// Мера «от нейтральной» (решение человека по TASK-0007.1, docs/RESEARCH.md
// «Funding Binance: к чему мерить «необычность»»)
export type FundingState =
  | 'above' // > нейтральной: лонги переплачивают
  | 'neutral' // ровно нейтральная 0,01 %
  | 'below' // 0 ≤ ставка < нейтральной
  | 'negative' // < 0: шорты платят лонгам
  | 'unknown'; // интервал выплат не 8 ч — нейтраль не установлена

export interface Stress {
  state: FundingState;
  // Доля выплат окна «так же далеко или дальше», 0–100: above — со ставкой
  // ≥ текущей; below/negative — ≤ текущей. null при neutral/unknown.
  tailPct: number | null;
  periodDays: number;
  samples: number; // выплат в окне
  intervalHours: number; // шаг двух последних выплат, округлён до часа
}

// Ответ GET /derivatives/:coinId (зеркало — frontend/src/types/derivatives.ts).
// Отказ источника — текстом в его поле, не 502 на весь ответ: источники
// независимы (план TASK-0007, «Контракты»).
export interface SourceError {
  error: string;
}

export interface FundingView {
  exchange: 'binance';
  rate: number; // доля: 0.0000809 = 0,00809 %; lastFundingRate
  nextFundingTime: number; // мс, из ответа Binance
  at: number; // мс, время premiumIndex
  stress: Stress | null; // null — история не загрузилась или пуста
}

export type ExchangeOpenInterest =
  | { exchange: Exchange; usd: number; at: number }
  | { exchange: Exchange; error: string };

export interface OpenInterestView {
  totalUsd: number | null; // сумма доступных бирж; null — ни одной
  exchanges: ExchangeOpenInterest[]; // всегда binance, okx, bybit
}

export interface Derivatives {
  coinId: string;
  market: string;
  funding: FundingView | SourceError;
  openInterest: OpenInterestView;
}

// --- История OI (TASK-0008) ---
// Шаг графика: по дням / по часам; окно всегда 30 дней
export type OiStep = '1d' | '1h';

// Точка ряда: OI учтённых бирж в один момент t (не метка биржи — у OKX
// метка на шаг раньше момента, research TASK-0008 «Дозамер»)
export interface OiPoint {
  t: number; // момент снимка, мс UTC, на сетке шага
  totalUsd: number; // сумма учтённых бирж в t
  byExchange: Partial<Record<Exchange, number>>; // USD каждой учтённой биржи
  price: number | null; // close спота Binance свечи, закрытой в t; null — нет свечи
}

// Ответ GET /derivatives/:coinId/open-interest?step= (зеркало —
// frontend/src/types/derivatives.ts). Отказ биржи — в её поле, биржа выпадает
// из суммы всех точек; все три упали — points пуст (план TASK-0008)
export interface OpenInterestHistory {
  coinId: string;
  market: string;
  step: OiStep;
  exchanges: ({ exchange: Exchange } | { exchange: Exchange; error: string })[]; // всегда binance, okx, bybit
  priceError: string | null; // спот недоступен — у всех точек price null
  points: OiPoint[]; // по возрастанию t; дыра — шаг между соседями больше step
}
