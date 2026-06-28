import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RunBacktestDto } from './backtest.dto';
import { BacktestResult, Candle } from './backtest.types';

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const PAGE_SIZE = 1000;
const REQUEST_DELAY_MS = 200;

const INTERVAL_MINUTES: Record<string, number> = {
  '1m': 1, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '4h': 240, '1d': 1440,
};

// Идентично NOISE_THRESHOLD в analyze.service.ts
const NOISE_THRESHOLDS: Record<string, number> = {
  BTCUSDT: 0.002,
  ETHUSDT: 0.0025,
  SOLUSDT: 0.004,
};
const DEFAULT_NOISE_THRESHOLD = 0.003;

// Минимум свечей до начала симуляции: сигнальная линия MACD валидна с индекса 33
const WARMUP = 34;

interface SimPosition {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  highPrice: number;
  lowPrice: number;
  units: number; // balance / entryPrice — размер позиции в монетах
}

interface IndicatorArrays {
  ema9: number[];
  ema21: number[];
  rsi: number[];
  macdLine: number[];
  macdSignal: number[];
  macdHist: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  bbBandwidth: number[];
  atr: number[];
}

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(private readonly httpService: HttpService) {}

  async run(dto: RunBacktestDto): Promise<BacktestResult> {
    const candles = await this.fetchCandles(dto.symbol, dto.interval, dto.days);

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const { macd: macdLine, signal: macdSignal, histogram: macdHist } =
      this.calcMACD(closes);
    const { upper: bbUpper, middle: bbMiddle, lower: bbLower, bandwidth: bbBandwidth } =
      this.calcBB(closes);

    const ind: IndicatorArrays = {
      ema9: this.calcEMA(closes, 9),
      ema21: this.calcEMA(closes, 21),
      rsi: this.calcRSI(closes),
      macdLine,
      macdSignal,
      macdHist,
      bbUpper,
      bbMiddle,
      bbLower,
      bbBandwidth,
      atr: this.calcATR(highs, lows, closes),
    };

    let balance = dto.initialBalance;
    let position: SimPosition | null = null;
    let positionEntryIndex = -1; // индекс свечи входа — стоп не проверяем на ней самой
    const trades: import('./backtest.types').BacktestTrade[] = [];

    for (let i = WARMUP; i < candles.length - 1; i++) {
      if (balance <= 0) break;

      const candle = candles[i];

      // 1. Обновляем trailing stop и проверяем закрытие
      // Пропускаем свечу входа: нельзя закрыться на том же тике что и открылись
      if (position !== null && i > positionEntryIndex) {
        if (position.type === 'BUY') {
          // Стоп двигается только при новом хае
          if (candle.high > position.highPrice && !isNaN(ind.atr[i])) {
            position.highPrice = candle.high;
            const newStop = candle.high - ind.atr[i] * dto.atrMultiplier;
            position.stopLoss = Math.max(position.stopLoss, newStop);
          }
          if (candle.low <= position.stopLoss) {
            const exitPrice = position.stopLoss;
            const pnl = position.units * (exitPrice - position.entryPrice);
            balance += pnl;
            trades.push({
              type: 'BUY',
              entryPrice: position.entryPrice,
              exitPrice,
              pnl,
              entryTime: position.entryTime,
              exitTime: candle.openTime,
            });
            position = null;
          }
        } else {
          // Стоп двигается только при новом лоу
          if (candle.low < position.lowPrice && !isNaN(ind.atr[i])) {
            position.lowPrice = candle.low;
            const newStop = candle.low + ind.atr[i] * dto.atrMultiplier;
            position.stopLoss = Math.min(position.stopLoss, newStop);
          }
          if (candle.high >= position.stopLoss) {
            const exitPrice = position.stopLoss;
            const pnl = position.units * (position.entryPrice - exitPrice);
            balance += pnl;
            trades.push({
              type: 'SELL',
              entryPrice: position.entryPrice,
              exitPrice,
              pnl,
              entryTime: position.entryTime,
              exitTime: candle.openTime,
            });
            position = null;
          }
        }
      }

      // 2. Ищем новый сигнал если позиции нет
      if (position === null && !isNaN(ind.atr[i])) {
        const signal = this.calcSignal(i, dto.symbol, closes, ind, dto.confluenceThreshold ?? 4.0);
        const direction = dto.direction ?? 'BOTH';
        if (signal !== 'SKIP' && (direction === 'BOTH' || signal === direction)) {
          const entryCandle = candles[i + 1];
          const entryPrice = entryCandle.open;
          const stopDistance = ind.atr[i] * dto.atrMultiplier;
          position = {
            type: signal,
            entryPrice,
            entryTime: entryCandle.openTime,
            stopLoss:
              signal === 'BUY'
                ? entryPrice - stopDistance
                : entryPrice + stopDistance,
            highPrice: entryPrice,
            lowPrice: entryPrice,
            units: balance / entryPrice,
          };
          positionEntryIndex = i + 1; // запоминаем индекс свечи входа
        }
      }
    }

    // Закрываем открытую позицию по close последней свечи
    if (position !== null) {
      const last = candles[candles.length - 1];
      const exitPrice = last.close;
      const pnl =
        position.type === 'BUY'
          ? position.units * (exitPrice - position.entryPrice)
          : position.units * (position.entryPrice - exitPrice);
      balance += pnl;
      trades.push({
        type: position.type,
        entryPrice: position.entryPrice,
        exitPrice,
        pnl,
        entryTime: position.entryTime,
        exitTime: last.openTime,
      });
    }

    this.logger.log(
      `Симуляция завершена: ${trades.length} сделок, баланс $${balance.toFixed(2)}`,
    );

    const metrics = this.calcMetrics(trades, dto.initialBalance, balance);

    return {
      symbol: dto.symbol,
      days: dto.days,
      totalCandles: candles.length,
      totalTrades: trades.length,
      wins: metrics.wins,
      losses: metrics.losses,
      winRate: metrics.winRate,
      totalPnl: metrics.totalPnl,
      totalPnlPct: metrics.totalPnlPct,
      maxDrawdown: metrics.maxDrawdown,
      sharpeRatio: metrics.sharpeRatio,
      finalBalance: balance,
      trades,
    };
  }

  private calcMetrics(
    trades: import('./backtest.types').BacktestTrade[],
    initialBalance: number,
    finalBalance: number,
  ) {
    if (trades.length === 0) {
      return {
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnl: 0,
        totalPnlPct: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
      };
    }

    const wins = trades.filter((t) => t.pnl > 0).length;
    const losses = trades.length - wins;
    const winRate = (wins / trades.length) * 100;
    const totalPnl = finalBalance - initialBalance;
    const totalPnlPct = (totalPnl / initialBalance) * 100;

    // maxDrawdown: максимальная просадка от пика по equity curve
    let peak = initialBalance;
    let maxDrawdown = 0;
    let runningBalance = initialBalance;
    for (const trade of trades) {
      runningBalance += trade.pnl;
      if (runningBalance > peak) peak = runningBalance;
      const drawdown = peak - runningBalance;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // sharpeRatio: упрощённый per-trade (avg / std, без risk-free rate)
    const pnls = trades.map((t) => t.pnl);
    const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance =
      pnls.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / pnls.length;
    const std = Math.sqrt(variance);
    const sharpeRatio = std > 0 ? avg / std : 0;

    return {
      wins,
      losses,
      winRate: parseFloat(winRate.toFixed(2)),
      totalPnl: parseFloat(totalPnl.toFixed(4)),
      totalPnlPct: parseFloat(totalPnlPct.toFixed(2)),
      maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
      sharpeRatio: parseFloat(sharpeRatio.toFixed(4)),
    };
  }

  private async fetchCandles(symbol: string, interval: string, days: number): Promise<Candle[]> {
    const intervalMinutes = INTERVAL_MINUTES[interval] ?? 5;
    const totalCandles = Math.ceil(days * 24 * 60 / intervalMinutes);
    const allCandles: Candle[] = [];
    let endTime = Date.now();

    this.logger.log(`Загружаю ${totalCandles} свечей ${interval} для ${symbol} за ${days} дней`);

    while (allCandles.length < totalCandles) {
      const remaining = totalCandles - allCandles.length;
      const limit = Math.min(remaining, PAGE_SIZE);

      const response = await firstValueFrom(
        this.httpService.get<unknown[][]>(BINANCE_KLINES_URL, {
          params: { symbol, interval, endTime, limit },
        }),
      );

      const batch = response.data;
      if (batch.length === 0) break;

      const candles: Candle[] = batch.map((k) => ({
        openTime: k[0] as number,
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
      }));

      // Добавляем в начало — идём назад во времени
      allCandles.unshift(...candles);

      // Следующая страница заканчивается до первой свечи текущей
      endTime = (batch[0][0] as number) - 1;

      if (batch.length < limit) break;

      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    // Обрезаем лишние свечи (могли набрать чуть больше нужного)
    const result = allCandles.slice(-totalCandles);
    this.logger.log(`Загружено ${result.length} свечей`);
    return result;
  }

  // Возвращает массив длиной prices.length.
  // Индексы 0..period-2 — NaN (недостаточно данных).
  // Индекс period-1 — простое среднее первых period цен (seed).
  // Далее: EMA[i] = price[i] * k + EMA[i-1] * (1-k), k = 2/(period+1).
  private calcEMA(prices: number[], period: number): number[] {
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
  private calcRSI(prices: number[], period = 14): number[] {
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
  private calcMACD(prices: number[]): {
    macd: number[];
    signal: number[];
    histogram: number[];
  } {
    const len = prices.length;
    const macdArr = new Array<number>(len).fill(NaN);
    const signalArr = new Array<number>(len).fill(NaN);
    const histArr = new Array<number>(len).fill(NaN);

    const ema12 = this.calcEMA(prices, 12);
    const ema26 = this.calcEMA(prices, 26);

    const macdStart = 25; // первый валидный индекс EMA26
    for (let i = macdStart; i < len; i++) {
      macdArr[i] = ema12[i] - ema26[i];
    }

    // Вычисляем EMA9 только на валидном срезе macd (без NaN prefix)
    if (len > macdStart + 8) {
      const macdSlice = macdArr.slice(macdStart);
      const signalSlice = this.calcEMA(macdSlice, 9);
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
  private calcBB(
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

  // ATR: True Range = max(H-L, |H-prevC|, |L-prevC|).
  // TR валиден с индекса 1, ATR (среднее period TR) валиден с индекса period.
  private calcATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period = 14,
  ): number[] {
    const len = closes.length;
    const tr = new Array<number>(len).fill(NaN);
    const result = new Array<number>(len).fill(NaN);

    for (let i = 1; i < len; i++) {
      tr[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
    }

    for (let i = period; i < len; i++) {
      const slice = tr.slice(i - period + 1, i + 1); // period значений TR, все валидны
      result[i] = slice.reduce((a, b) => a + b, 0) / period;
    }

    return result;
  }

  // Тренд по последним points свечам — идентично getTrend в price.service.ts.
  private calcTrend(
    closes: number[],
    i: number,
    points = 10,
  ): 'up' | 'down' | 'flat' {
    if (i < points - 1) return 'flat';
    const slice = closes.slice(i - points + 1, i + 1);
    let ups = 0, downs = 0;
    for (let j = 1; j < slice.length; j++) {
      if (slice[j] > slice[j - 1]) ups++;
      else if (slice[j] < slice[j - 1]) downs++;
    }
    if (ups > downs * 1.5) return 'up';
    if (downs > ups * 1.5) return 'down';
    return 'flat';
  }

  // Трендовая стратегия: три трендовых индикатора дают вес (макс 5.0),
  // RSI и BB — только фильтры перекупленности/перепроданности.
  private calcSignal(
    i: number,
    symbol: string,
    closes: number[],
    ind: IndicatorArrays,
    confluenceThreshold = 4.0,
  ): 'BUY' | 'SELL' | 'SKIP' {
    if (i < 1) return 'SKIP';

    const noiseThreshold = NOISE_THRESHOLDS[symbol] ?? DEFAULT_NOISE_THRESHOLD;
    const changePct = Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]);
    if (changePct < noiseThreshold) return 'SKIP';

    let buy = 0;
    let sell = 0;

    // EMA кросс (вес 2.0)
    if (!isNaN(ind.ema9[i]) && !isNaN(ind.ema21[i])) {
      if (ind.ema9[i] > ind.ema21[i]) buy += 2.0;
      else sell += 2.0;
    }

    // MACD (вес 2.0)
    if (!isNaN(ind.macdLine[i]) && !isNaN(ind.macdSignal[i])) {
      if (ind.macdLine[i] > ind.macdSignal[i] && ind.macdHist[i] > 0) buy += 2.0;
      else if (ind.macdLine[i] < ind.macdSignal[i] && ind.macdHist[i] < 0) sell += 2.0;
    }

    // Тренд (вес 1.0)
    const trend = this.calcTrend(closes, i);
    if (trend === 'up') buy += 1.0;
    else if (trend === 'down') sell += 1.0;

    if (buy < confluenceThreshold && sell < confluenceThreshold) return 'SKIP';

    const signal: 'BUY' | 'SELL' = buy >= confluenceThreshold ? 'BUY' : 'SELL';

    // Фильтр перекупленности/перепроданности — блокирует вход, не даёт вес
    if (signal === 'BUY') {
      const overbought =
        (!isNaN(ind.rsi[i]) && ind.rsi[i] > 70) ||
        (!isNaN(ind.bbUpper[i]) && closes[i] >= ind.bbUpper[i]);
      if (overbought) return 'SKIP';
    } else {
      const oversold =
        (!isNaN(ind.rsi[i]) && ind.rsi[i] < 30) ||
        (!isNaN(ind.bbLower[i]) && closes[i] <= ind.bbLower[i]);
      if (oversold) return 'SKIP';
    }

    return signal;
  }
}
