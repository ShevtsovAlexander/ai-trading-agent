// ---------------------------------------------------------------------------
// Стакан сейчас (TASK-0009). Зеркало backend/src/orderbook/orderbook.types.ts
// и Wall из backend/src/orderbook/walls.ts — формы меняются вместе.
// ---------------------------------------------------------------------------

export type BookExchange = 'binance' | 'okx';

// Ступень цены: заявки обеих бирж с ценой в [from, to). Ступень с ценой
// внутри обрезана по mid — полоса не заходит за цену
export interface Wall {
    from: number; // USDT
    to: number;
    coin: number; // объём, монеты
    usdt: number; // Σ цена × объём
    byExchange: Partial<Record<BookExchange, number>>; // монеты; нет заявок — нет ключа
}

export type ExchangeState =
    | { exchange: BookExchange; at: number }
    | { exchange: BookExchange; error: string };

// GET /orderbook/:coinId. Обе биржи упали — mid и coverage null, стороны пусты
export interface OrderBookSnapshot {
    coinId: string;
    market: string;
    at: number; // мс, часы бэкенда после ответа обеих бирж
    mid: number | null;
    step: number; // шаг ступени, USDT
    coverage: { bid: number; ask: number } | null; // общий край охвата, цены
    exchanges: ExchangeState[]; // всегда binance, okx
    bids: Wall[]; // ≤ 10, по убыванию usdt
    asks: Wall[];
}
