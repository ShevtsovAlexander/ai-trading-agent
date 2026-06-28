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
export interface Position {
    id: number;
    coinId: string;
    market: string;
    decision: 'BUY' | 'SELL';
    entryPrice: number;
    stopLoss: number;
    highPrice: number;
    lowPrice: number;
    status: 'OPEN' | 'CLOSED';
    closedPrice: number | null;
    pnl: number | null;
    closedAt: string | null;
    createdAt: string;
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
export interface Wallet {
    id: number;
    balance: number;
    initialBalance: number;
    createdAt: string;
    updatedAt: string;
}
export interface WalletStats {
    balance: number;
    initialBalance: number;
    pnl: number;
    pnlPct: number;
    profit: number;
    loss: number;
    transactions: number;
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