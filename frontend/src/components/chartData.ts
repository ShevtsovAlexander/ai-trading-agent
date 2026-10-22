import type {
  CandlestickData,
  LineData,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import { INTERVAL_MS } from "../types/market";
import type { Candle, HistoryChunk, Interval, MarketSeries, SeriesPoint } from "../types/market";

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

// Куски истории + основное окно → один ряд по t, по возрастанию, без
// дублей; на совпадении t берётся main (свежий ответ).
// coinId/interval/range — от main: seriesKey не меняется на догрузке.
// Пропускается кусок чужой монеты/интервала (опоздавший ответ) и битый —
// series не в пару candles: toChartData упал бы на нём вместе с main.
export const mergeSeries = (chunks: HistoryChunk[], main: MarketSeries): MarketSeries => {
    const byT = new Map<number, [Candle, SeriesPoint]>();
    const put = (candles: Candle[], series: SeriesPoint[]) =>
        candles.forEach((c, i) => byT.set(c.t, [c, series[i]]));
    for (const ch of chunks) {
        if (
            ch.coinId === main.coinId &&
            ch.interval === main.interval &&
            ch.series.length === ch.candles.length
        ) {
            put(ch.candles, ch.series);
        }
    }
    put(main.candles, main.series);
    const merged = [...byT.values()].sort((a, b) => a[0].t - b[0].t);
    return {
        ...main,
        candles: merged.map(([c]) => c),
        series: merged.map(([, s]) => s),
    };
};

// Новое окно того же ключа стыкуется с прежним: последняя свеча прежнего —
// не левее свечи перед новым левым краем. Нет — окно уехало дальше своей
// длины (сон, простой бэкенда): свечи между окнами есть только у Binance,
// склейка нарисовала бы ложный разрыв — историю сбрасывают (критик T4).
export const adjoins = (prev: MarketSeries, next: MarketSeries): boolean => {
    if (seriesKey(prev) !== seriesKey(next)) return false;
    if (prev.candles.length === 0 || next.candles.length === 0) return false;
    const step = INTERVAL_MS[next.interval];
    return prev.candles[prev.candles.length - 1].t >= next.candles[0].t - step;
};

// Основное окно — последние N свечей: опрос сдвигает его ЛЕВЫЙ край
// вправо, и свечи между старым и новым краем пропали бы из склейки — кусок
// истории кончается на старом крае (критик T4). Это они, кусок с
// before = новый левый край; ряды — тот же ответ бэкенда. null — ничего
// не вытеснено или окна не стыкуются (adjoins).
export const evicted = (prev: MarketSeries, next: MarketSeries): HistoryChunk | null => {
    if (!adjoins(prev, next)) return null;
    const before = next.candles[0].t;
    const n = prev.candles.findIndex((c) => c.t >= before);
    const count = n === -1 ? prev.candles.length : n;
    if (count === 0) return null;
    return {
        coinId: prev.coinId,
        market: prev.market,
        interval: prev.interval,
        before,
        candles: prev.candles.slice(0, count),
        series: prev.series.slice(0, count),
        complete: false,
    };
};

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
