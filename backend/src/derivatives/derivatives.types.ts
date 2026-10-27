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
