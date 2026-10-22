import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { fetchClosedCandles } from '../binance/klines';
import {
  calcBB,
  calcEMA,
  calcMACD,
  calcRSI,
  calcSMA,
  calcTrend,
} from '../indicators/indicators';
import {
  COINS,
  Candle,
  INTERVAL_MS,
  Interval,
  MAX_CANDLES,
  MIN_CANDLES,
  MarketSeries,
  MarketView,
  RANGE_MS,
  Range,
  SeriesPoint,
  WARMUP,
  isAllowed,
} from './market.types';

const VIEW_CANDLES = 10; // окно тренда (как getTrend); recent — последние 5
const RECENT = 5;
const CACHE_SIZE = 50;
// Свеча считается закрытой через 5 с после closeTime: закрытость решают
// локальные часы (klines.ts), а кэш держит результат целый интервал — если
// часы спешат, незакрытая свеча жила бы в кэше до суток (1d).
export const CLOSE_MARGIN_MS = 5000;
// 80 % минутного лимита Binance (6000): выше — догрузка истории ждёт,
// основное окно и карточку не режем (план TASK-0006, trade-off 5)
export const WEIGHT_GUARD = 4800;
const MINUTE_MS = 60_000;

// NaN из indicators.ts — «периоду не хватило свечей»
const round = (value: number | undefined): number | null =>
  value === undefined || Number.isNaN(value)
    ? null
    : parseFloat(value.toFixed(2));

interface Computed {
  candles: Candle[]; // только свечи окна, разогрев отрезан
  series: SeriesPoint[];
  closes: number[]; // close с разогревом — вход для MA5 и тренда
}

// Свечи Binance → ряды индикаторов. В БД ничего не пишет: история — у
// Binance, у нас только кэш до закрытия следующей свечи.
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly cache = new Map<string, Computed>();
  // Последний вес IP из заголовка Binance и время ответа
  private lastWeight: { weight: number; at: number } | null = null;

  // Часы — поле, чтобы тест мог сдвинуть время на интервал
  clock: () => number = Date.now;

  constructor(private http: HttpService) {}

  async getSeries(
    coinId: string,
    interval: string,
    range: string,
  ): Promise<MarketSeries> {
    const coin = this.coin(coinId);
    const iv = this.interval(interval);
    if (!Object.hasOwn(RANGE_MS, range)) {
      throw new BadRequestException(`Неизвестный диапазон: ${range}`);
    }
    const rg = range as Range;
    if (!isAllowed(rg, iv)) {
      throw new BadRequestException(
        `Диапазон ${rg} на интервале ${iv} — нужно от ${MIN_CANDLES} до ${MAX_CANDLES} свечей`,
      );
    }

    const count = RANGE_MS[rg] / INTERVAL_MS[iv];
    const { candles, series } = await this.compute(coinId, iv, count);
    return {
      coinId,
      market: coin.market,
      interval: iv,
      range: rg,
      candles,
      series,
    };
  }

  async getView(coinId: string, interval: string): Promise<MarketView> {
    const coin = this.coin(coinId);
    const iv = this.interval(interval);
    const { candles, series, closes } = await this.compute(
      coinId,
      iv,
      VIEW_CANDLES,
    );
    if (candles.length < 2) {
      throw new BadGatewayException('Binance не отдал свечей');
    }

    const last = candles[candles.length - 1];
    const sma5 = calcSMA(closes, 5);
    return {
      coinId,
      market: coin.market,
      interval: iv,
      closedAt: last.t + INTERVAL_MS[iv] - 1,
      price: last.close,
      previousPrice: candles[candles.length - 2].close,
      ma5: round(sma5[sma5.length - 1]),
      trend: calcTrend(closes.slice(-VIEW_CANDLES)),
      latest: series[series.length - 1],
      recent: series.slice(-RECENT),
      aiComment: null,
    };
  }

  private coin(coinId: string) {
    if (!Object.hasOwn(COINS, coinId)) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    return COINS[coinId];
  }

  private interval(interval: string): Interval {
    if (!Object.hasOwn(INTERVAL_MS, interval)) {
      throw new BadRequestException(`Неизвестный интервал: ${interval}`);
    }
    return interval as Interval;
  }

  private noteWeight(weight: number | null): void {
    if (weight !== null) this.lastWeight = { weight, at: this.clock() };
  }

  // Вес у порога в текущей минуте UTC. Binance обнуляет вес с началом
  // минуты — замер прошлой минуты уже не говорит ничего.
  weightExhausted(): boolean {
    if (!this.lastWeight) return false;
    const sameMinute =
      Math.floor(this.lastWeight.at / MINUTE_MS) ===
      Math.floor(this.clock() / MINUTE_MS);
    return sameMinute && this.lastWeight.weight >= WEIGHT_GUARD;
  }

  // count последних закрытых свечей + WARMUP слева, ряды с отрезанным
  // разогревом. Последняя закрытая — по часам: свеча, открытая на
  // floor(now/интервал)·интервал, ещё идёт, закрыта предыдущая.
  private async compute(
    coinId: string,
    interval: Interval,
    count: number,
  ): Promise<Computed> {
    const step = INTERVAL_MS[interval];
    const now = this.clock() - CLOSE_MARGIN_MS;
    const lastOpen = Math.floor(now / step) * step - step;
    const rangeStart = lastOpen - (count - 1) * step;

    // Набор закрытых свечей меняется только на закрытии — ключ с lastOpen
    // точен до закрытия следующей свечи
    const key = `${coinId}|${interval}|${count}|${lastOpen}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let all: Candle[];
    try {
      const fetched = await fetchClosedCandles(
        this.http,
        COINS[coinId].symbol,
        interval,
        rangeStart - WARMUP * step,
        lastOpen,
        now,
      );
      all = fetched.candles;
      this.noteWeight(fetched.usedWeight);
    } catch (error) {
      this.logger.error(
        `klines ${coinId} ${interval}: ${(error as Error).message}`,
      );
      throw new BadGatewayException('Binance недоступен');
    }

    const closes = all.map((c) => c.close);
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const rsi = calcRSI(closes, 14);
    const macd = calcMACD(closes);
    const bb = calcBB(closes, 20);

    const from = all.findIndex((c) => c.t >= rangeStart);
    const start = from === -1 ? all.length : from;
    const candles = all.slice(start);
    const series = candles.map((c, j) => {
      const i = start + j;
      return {
        t: c.t,
        close: c.close,
        ema9: round(ema9[i]),
        ema21: round(ema21[i]),
        rsi: round(rsi[i]),
        macd: round(macd.macd[i]),
        macdSignal: round(macd.signal[i]),
        macdHistogram: round(macd.histogram[i]),
        bbUpper: round(bb.upper[i]),
        bbMiddle: round(bb.middle[i]),
        bbLower: round(bb.lower[i]),
        bbBandwidth: round(bb.bandwidth[i]),
      };
    });

    const result = { candles, series, closes };

    // Binance ещё не отдал только что закрытую свечу — не кэшируем, иначе
    // устаревший ряд жил бы до следующего закрытия
    if (candles.length > 0 && candles[candles.length - 1].t === lastOpen) {
      if (this.cache.size >= CACHE_SIZE) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
      this.cache.set(key, result);
    }
    return result;
  }
}
