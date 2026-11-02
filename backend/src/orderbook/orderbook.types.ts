import type { Wall } from './walls';

// Символы спота по coinId — те же ключи, что COINS (market/market.types.ts).
// Binance — символ спота как у свечей; OKX — инструмент спота, не SWAP
// (research TASK-0009, «Не найдено»: в коде были только фьючерсные).
export const ORDERBOOK_SYMBOLS: Record<
  string,
  { binance: string; okx: string }
> = {
  bitcoin: { binance: 'BTCUSDT', okx: 'BTC-USDT' },
  ethereum: { binance: 'ETHUSDT', okx: 'ETH-USDT' },
  solana: { binance: 'SOLUSDT', okx: 'SOL-USDT' },
};

// Шаг ступени цены, USDT: ≈ 0,013 / 0,044 / 0,053 % от цены 2026-11-02, не
// мельче шага цены OKX BTC 0.1 (план TASK-0009, trade-off 1). Прикидка —
// пересмотр по виду на графике (T6)
export const BUCKET_STEP: Record<string, number> = {
  bitcoin: 10,
  ethereum: 1,
  solana: 0.05,
};

export const WALLS_PER_SIDE = 10;
// Уровней на сторону за один запрос: максимум и у Binance depth, и у OKX
// books-full. Сторона короче — биржа отдала её целиком
export const BOOK_DEPTH = 5000;

export type BookExchange = 'binance' | 'okx';

// Уровень стакана: [цена, объём в монетах]
export type Level = [number, number];

// Разобранный стакан одной биржи. bids — по убыванию цены, asks — по
// возрастанию (проверено разбором). full — сторона короче BOOK_DEPTH: края
// охвата у неё нет. at — время снимка, мс: у OKX из ответа (ts), у Binance —
// часы бэкенда (в ответе depth времени нет, research TASK-0009, риск 4)
export interface Book {
  bids: Level[];
  asks: Level[];
  full: { bid: boolean; ask: boolean };
  at: number;
}

// Снимок стакана живёт 15 с: опрос фронта — 20 с, несколько вкладок не
// множат запросы (план TASK-0009, trade-off 4). Кэшируется и ответ с
// ошибкой — повтор к упавшей бирже не чаще раза в 15 с
export const SNAPSHOT_TTL_MS = 15_000;

// Ожидание ответа биржи: зависшая биржа — отказ в её поле, а не висящий
// маршрут (решение человека по критику T3; как news.service.ts:23). 10 с —
// меньше опроса 20 с: запросы не копятся
export const BOOK_TIMEOUT_MS = 10_000;

export type ExchangeState =
  | { exchange: BookExchange; at: number }
  | { exchange: BookExchange; error: string };

// Ответ GET /orderbook/:coinId (план TASK-0009, «Контракты»). Обе биржи
// упали — mid и coverage null, стороны пусты, ошибки в exchanges (решение
// человека к T3; 200, не 502 — как деривативы)
export interface OrderBookSnapshot {
  coinId: string;
  market: string; // 'BTC/USDT'
  at: number; // мс, часы бэкенда после ответа обеих бирж
  mid: number | null; // середина Binance, Binance упал — OKX
  step: number; // шаг ступени, USDT
  coverage: { bid: number; ask: number } | null; // общий край охвата, цены
  exchanges: ExchangeState[]; // всегда binance, okx — в этом порядке
  bids: Wall[]; // ≤ WALLS_PER_SIDE, по убыванию usdt
  asks: Wall[];
}
