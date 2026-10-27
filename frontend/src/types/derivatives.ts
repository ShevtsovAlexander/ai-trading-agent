// ---------------------------------------------------------------------------
// Деривативы (TASK-0007). Зеркало backend/src/derivatives/derivatives.types.ts
// — формы ответа меняются в обоих файлах вместе.
// ---------------------------------------------------------------------------

export type Exchange = 'binance' | 'okx' | 'bybit';

// Мера «от нейтральной» (docs/RESEARCH.md, секция funding)
export type FundingState =
    | 'above' // > нейтральной: лонги переплачивают
    | 'neutral' // ровно нейтральная 0,01 %
    | 'below' // 0 ≤ ставка < нейтральной
    | 'negative' // < 0: шорты платят лонгам
    | 'unknown'; // интервал выплат не 8 ч — нейтраль не установлена

export interface Stress {
    state: FundingState;
    // Доля выплат окна «так же далеко или дальше», 0–100; null при
    // neutral/unknown. Бэкенд не округляет — округляет показ
    tailPct: number | null;
    periodDays: number;
    samples: number;
    intervalHours: number;
}

export interface SourceError {
    error: string;
}

export interface FundingView {
    exchange: 'binance';
    rate: number; // доля: 0.0000809 = 0,00809 %
    nextFundingTime: number; // мс
    at: number; // мс
    stress: Stress | null; // null — история не загрузилась
}

export type ExchangeOpenInterest =
    | { exchange: Exchange; usd: number; at: number }
    | { exchange: Exchange; error: string };

export interface OpenInterestView {
    totalUsd: number | null; // сумма доступных бирж; null — ни одной
    exchanges: ExchangeOpenInterest[]; // всегда binance, okx, bybit
}

// GET /derivatives/:coinId
export interface Derivatives {
    coinId: string;
    market: string;
    funding: FundingView | SourceError;
    openInterest: OpenInterestView;
}
