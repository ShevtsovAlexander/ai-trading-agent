export interface PriceSnapshot {
    id: number;
    coinId: string;
    price: number;
    createdAt: string;
}
export interface MACD {
    macd: number;
    signal: number;
    histogram: number;
}
export interface BollingerBands {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
}
export interface TradeDecision {
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
    decision: 'BUY' | 'SELL' | 'SKIP';
    confidence: number;
    riskScore: number;
    expectedValue: number;
    reason: string;
    aiReasoning: string;
    createdAt: string;
}
export interface AnalyzeRequest {
    market: string;
    coinId: string;
    volume: number;
}
export interface AnalyzeResponse extends Omit<TradeDecision, 'id' | 'createdAt' | 'ema9' | 'ema21' | 'rsi' | 'macd' | 'bb'> {
    ema9: number;
    ema21: number;
    rsi: number;
    macd: MACD;
    bb: BollingerBands;
    timestamp: string;
}