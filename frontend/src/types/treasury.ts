// ---------------------------------------------------------------------------
// Компании-держатели (TASK-0013). Зеркало backend/src/treasury/treasury.types.ts
// — формы ответа меняются в обоих файлах вместе.
// ---------------------------------------------------------------------------

export interface TreasuryCompany {
    name: string;
    symbol: string; // тикер акции, 'MSTR.US'
    country: string;
    holdings: number; // монет
    valueUsd: number;
}

// GET /treasury/:coinId. Источник один (CoinGecko) — отказ = 502 с текстом
export interface Treasury {
    coinId: string;
    market: string;
    totalHoldings: number; // монет у публичных компаний
    totalValueUsd: number;
    companies: number;
    shareOfCirculatingPct: number | null; // от монет в обращении; null — нет данных
    top: TreasuryCompany[]; // 5 крупнейших
    fetchedAt: number; // мс, когда бэкенд получил ответ CoinGecko
}
