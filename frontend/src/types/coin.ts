// ---------------------------------------------------------------------------
// Поля монеты (TASK-0010). Зеркало backend/src/coin/coin.types.ts — формы
// ответа меняются в обоих файлах вместе.
// ---------------------------------------------------------------------------

// GET /coin/:coinId. Источник один (CoinGecko) — его отказ = 502 с текстом
export interface CoinFields {
    coinId: string;
    market: string;
    marketCapUsd: number;
    // У CoinGecko FDV = цена × total, не × max (у BTC FDV = капитализации)
    fdvUsd: number | null;
    circulating: number; // монеты
    total: number | null; // монеты
    max: number | null; // монеты; null — лимита нет
    updatedAt: number; // мс, last_updated CoinGecko
}
