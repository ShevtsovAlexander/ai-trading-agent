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
