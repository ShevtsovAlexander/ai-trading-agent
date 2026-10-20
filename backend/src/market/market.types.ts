// Свеча Binance в форме, с которой работает дашборд. t — время открытия
// свечи (openTime, мс): по нему строится ось графика и ключи кэша.
export interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
