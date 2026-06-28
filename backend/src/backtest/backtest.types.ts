export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestTrade {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  entryTime: number;
  exitTime: number;
}

export interface BacktestResult {
  symbol: string;
  days: number;
  totalCandles: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalPnlPct: number;
  maxDrawdown: number;
  sharpeRatio: number;
  finalBalance: number;
  trades: BacktestTrade[];
}
