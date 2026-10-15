// Формулы индикаторов — чистые функции. Вынесены из BacktestService, чтобы
// живой контур (PriceService) считал по тем же формулам, а не по своей копии,
// которая разошлась с этой. indicators.spec.ts сверяет их с technicalindicators;
// RSI пока не сверяется по-настоящему (простое среднее против Уайлдера у
// эталона), и PriceService ещё на своих формулах — оба пункта в TASK-0002.

// Возвращает массив длиной prices.length.
// Индексы 0..period-2 — NaN (недостаточно данных).
// Индекс period-1 — простое среднее первых period цен (seed).
// Далее: EMA[i] = price[i] * k + EMA[i-1] * (1-k), k = 2/(period+1).
export function calcEMA(prices: number[], period: number): number[] {
  const result = new Array<number>(prices.length).fill(NaN);
  if (prices.length < period) return result;

  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result[i] = ema;
  }

  return result;
}

// Возвращает массив длиной prices.length.
// Валидные значения начиная с индекса period (нужно period+1 цен для period дельт).
// Алгоритм идентичен getRSI в price.service.ts — простое среднее gains/losses.
export function calcRSI(prices: number[], period = 14): number[] {
  const result = new Array<number>(prices.length).fill(NaN);

  for (let i = period; i < prices.length; i++) {
    const slice = prices.slice(i - period, i + 1); // period+1 цен = period дельт
    const changes = slice.slice(1).map((p, j) => p - slice[j]);

    const avgGain =
      changes.reduce((sum, c) => sum + (c > 0 ? c : 0), 0) / period;
    const avgLoss =
      changes.reduce((sum, c) => sum + (c < 0 ? Math.abs(c) : 0), 0) /
      period;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

// MACD линия = EMA12 - EMA26, валидна с индекса 25.
// Сигнальная линия = EMA9 от MACD, валидна с индекса 33.
// Для signal EMA срезаем macd с первого валидного индекса, чтобы calcEMA не получал NaN.
export function calcMACD(prices: number[]): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const len = prices.length;
  const macdArr = new Array<number>(len).fill(NaN);
  const signalArr = new Array<number>(len).fill(NaN);
  const histArr = new Array<number>(len).fill(NaN);

  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);

  const macdStart = 25; // первый валидный индекс EMA26
  for (let i = macdStart; i < len; i++) {
    macdArr[i] = ema12[i] - ema26[i];
  }

  // Вычисляем EMA9 только на валидном срезе macd (без NaN prefix)
  if (len > macdStart + 8) {
    const macdSlice = macdArr.slice(macdStart);
    const signalSlice = calcEMA(macdSlice, 9);
    for (let i = 0; i < signalSlice.length; i++) {
      if (!isNaN(signalSlice[i])) {
        signalArr[macdStart + i] = signalSlice[i];
        histArr[macdStart + i] = macdArr[macdStart + i] - signalSlice[i];
      }
    }
  }

  return { macd: macdArr, signal: signalArr, histogram: histArr };
}

// Bollinger Bands: rolling window period свечей.
// middle = SMA, stddev = population std, upper/lower = middle ± 2*stddev.
// Валидны с индекса period-1.
export function calcBB(
  prices: number[],
  period = 20,
): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] } {
  const len = prices.length;
  const upper = new Array<number>(len).fill(NaN);
  const middle = new Array<number>(len).fill(NaN);
  const lower = new Array<number>(len).fill(NaN);
  const bandwidth = new Array<number>(len).fill(NaN);

  for (let i = period - 1; i < len; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mid = slice.reduce((a, b) => a + b, 0) / period;
    const variance =
      slice.reduce((sum, p) => sum + Math.pow(p - mid, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    middle[i] = mid;
    upper[i] = mid + 2 * stdDev;
    lower[i] = mid - 2 * stdDev;
    bandwidth[i] = ((upper[i] - lower[i]) / mid) * 100;
  }

  return { upper, middle, lower, bandwidth };
}
