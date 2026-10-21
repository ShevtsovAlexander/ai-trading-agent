import type {
  CandlestickData,
  LineData,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import { INTERVAL_MS } from "../types/market";
import type { Interval, MarketSeries } from "../types/market";

type Whitespace = WhitespaceData<UTCTimestamp>;
type Line = (LineData<UTCTimestamp> | Whitespace)[];

// Все ряды одной длины и с одинаковыми time: i-я точка любого ряда — одна и
// та же свеча (или один и тот же разрыв). На этом держится полоса BB —
// заливка берёт bbUpper[i] и bbLower[i] попарно. У линии последняя точка
// перед разрывом — с color: BRIDGE (см. ниже).
export interface ChartData {
  candles: (CandlestickData<UTCTimestamp> | Whitespace)[];
  ema9: Line;
  ema21: Line;
  bbUpper: Line;
  bbLower: Line;
}

// Дыра между соседними свечами длиннее 3 интервалов — Binance не отдал
// свечи (остановка биржи). Ось lightweight-charts — по барам, не по времени:
// без вставки пропуск схлопнулся бы бесследно. Пустая точка посередине даёт
// пустой слот на оси и рвёт все линии.
const GAP_INTERVALS = 3;

// LineSeries рисует линию через пустую точку насквозь: библиотека пропускает
// whitespace и соединяет соседей. Отрезок i-1→i красится цветом точки i-1 —
// прозрачная последняя точка перед разрывом делает «мост» невидимым
// (исходник lightweight-charts 5.2.1, walkLine/changeStyle; критик T6)
const BRIDGE = "transparent";

// t — мс (время открытия свечи), а lightweight-charts ждёт секунды UTC
const toTime = (ms: number) => Math.round(ms / 1000) as UTCTimestamp;

// null — периоду индикатора не хватило свечей: пустая точка, не value: null
const line = (time: UTCTimestamp, value: number | null) =>
  value == null ? { time } : { time, value };

// Ключ данных графика: монета|интервал|диапазон
export const seriesKey = (d: MarketSeries) => `${d.coinId}|${d.interval}|${d.range}`;

export const toChartData = (
  data: MarketSeries,
  interval: Interval,
): ChartData => {
  const out: ChartData = {
    candles: [],
    ema9: [],
    ema21: [],
    bbUpper: [],
    bbLower: [],
  };
  const gapMs = GAP_INTERVALS * INTERVAL_MS[interval];

  // Бэкенд отдаёт series[i].t === candles[i].t
  data.candles.forEach((c, i) => {
    const s = data.series[i];
    const prev = data.candles[i - 1];
    if (prev && c.t - prev.t > gapMs) {
      for (const l of [out.ema9, out.ema21, out.bbUpper, out.bbLower]) {
        const last = l[l.length - 1];
        if ("value" in last) l[l.length - 1] = { ...last, color: BRIDGE };
      }
      const gap = { time: toTime((prev.t + c.t) / 2) };
      out.candles.push(gap);
      out.ema9.push(gap);
      out.ema21.push(gap);
      out.bbUpper.push(gap);
      out.bbLower.push(gap);
    }
    const time = toTime(c.t);
    out.candles.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    out.ema9.push(line(time, s.ema9));
    out.ema21.push(line(time, s.ema21));
    out.bbUpper.push(line(time, s.bbUpper));
    out.bbLower.push(line(time, s.bbLower));
  });

  return out;
};
