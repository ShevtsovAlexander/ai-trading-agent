import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
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
  HISTORY_CHUNK,
  HistoryChunk,
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
export const WEIGHT_THROTTLE = 4800;
const WEIGHT_LIMIT = 6000;
const MINUTE_MS = 60_000;
// Binance отказал по лимиту: 429 — превышен вес, 418 — бан IP за повторы
const LIMIT_STATUSES = [429, 418];
const LIMIT_MESSAGE = 'Лимит Binance — история догрузится через минуту';

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
  private weightMissingWarned = false;
  // Кусок истории неизменен (все свечи закрыты) — ключ без «сейчас»
  private readonly historyCache = new Map<string, HistoryChunk>();

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

  // Свечи левее before (HISTORY_CHUNK) с рядами по ним — тем же расчётом,
  // что основное окно: свой WARMUP слева, поэтому значения = длинный ряд.
  // Ограничитель запросов режет только историю; кэшированный кусок отдаётся
  // и при нём.
  async getHistory(
    coinId: string,
    interval: string,
    before: string,
  ): Promise<HistoryChunk> {
    const coin = this.coin(coinId);
    const iv = this.interval(interval);
    const step = INTERVAL_MS[iv];
    const lastOpen = this.lastOpen(step);
    const b = /^\d+$/.test(before) ? Number(before) : NaN;
    if (!Number.isSafeInteger(b) || b % step !== 0 || b > lastOpen) {
      throw new BadRequestException(
        `before — openTime свечи ${iv} не позже последней закрытой: ${before}`,
      );
    }

    const key = `${coinId}|${iv}|${b}`;
    const cached = this.historyCache.get(key);
    if (cached) return cached;

    if (this.historyThrottled()) {
      throw new HttpException(LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }

    const chunkStart = b - HISTORY_CHUNK * step;
    const all = await this.fetch(
      coinId,
      iv,
      Math.max(0, chunkStart - WARMUP * step),
      b - step,
      true,
    );
    const { candles, series } = this.toSeries(all, chunkStart);
    const result: HistoryChunk = {
      coinId,
      market: coin.market,
      interval: iv,
      before: b,
      candles,
      series,
      // Левее куска у Binance ничего: в окне с разогревом нет свечей до
      // начала куска (листинг внутри куска или кусок пуст)
      complete: all.length === 0 || all[0].t >= chunkStart,
    };

    // Кэш — только если правая свеча на месте: усечённый ответ Binance при
    // сбое не должен застрять. Кусок на листинге или у остановки биржи не
    // кэшируется — лишний запрос, результат тот же (критик T3).
    if (candles.length > 0 && candles[candles.length - 1].t === b - step) {
      if (this.historyCache.size >= CACHE_SIZE) {
        this.historyCache.delete(
          this.historyCache.keys().next().value as string,
        );
      }
      this.historyCache.set(key, result);
    }
    return result;
  }

  private noteWeight(weight: number | null): void {
    if (weight === null) {
      // Без заголовка ограничитель выключен — сказать об этом один раз
      if (!this.weightMissingWarned) {
        this.logger.warn(
          'Binance не прислал x-mbx-used-weight-1m — ограничитель запросов выключен',
        );
        this.weightMissingWarned = true;
      }
      return;
    }
    this.weightMissingWarned = false;
    this.lastWeight = { weight, at: this.clock() };
  }

  // Вес у порога в текущей минуте UTC. Binance обнуляет вес с началом
  // минуты — замер прошлой минуты уже не говорит ничего.
  historyThrottled(): boolean {
    if (!this.lastWeight) return false;
    const sameMinute =
      Math.floor(this.lastWeight.at / MINUTE_MS) ===
      Math.floor(this.clock() / MINUTE_MS);
    return sameMinute && this.lastWeight.weight >= WEIGHT_THROTTLE;
  }

  // Последняя закрытая — по часам: свеча, открытая на
  // floor(now/интервал)·интервал, ещё идёт, закрыта предыдущая.
  private lastOpen(step: number): number {
    const now = this.clock() - CLOSE_MARGIN_MS;
    return Math.floor(now / step) * step - step;
  }

  // Закрытые свечи [start, end] + вес в ограничитель. Отказ Binance по
  // лимиту (429/418) включает ограничитель до конца минуты; история отвечает на него 429,
  // основное окно — 502, как на любую ошибку Binance.
  private async fetch(
    coinId: string,
    interval: Interval,
    start: number,
    end: number,
    history = false,
  ): Promise<Candle[]> {
    // Окно до эпохи (before = 0): запроса нет — и веса нет, ограничитель не трогаем
    if (start > end) return [];
    try {
      const fetched = await fetchClosedCandles(
        this.http,
        COINS[coinId].symbol,
        interval,
        start,
        end,
        this.clock() - CLOSE_MARGIN_MS,
      );
      this.noteWeight(fetched.usedWeight);
      return fetched.candles;
    } catch (error) {
      this.logger.error(
        `klines ${coinId} ${interval}: ${(error as Error).message}`,
      );
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status !== undefined && LIMIT_STATUSES.includes(status)) {
        this.lastWeight = { weight: WEIGHT_LIMIT, at: this.clock() };
        if (history) {
          throw new HttpException(LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
      }
      throw new BadGatewayException('Binance недоступен');
    }
  }

  // count последних закрытых свечей + WARMUP слева, ряды с отрезанным
  // разогревом.
  private async compute(
    coinId: string,
    interval: Interval,
    count: number,
  ): Promise<Computed> {
    const step = INTERVAL_MS[interval];
    const lastOpen = this.lastOpen(step);
    const rangeStart = lastOpen - (count - 1) * step;

    // Набор закрытых свечей меняется только на закрытии — ключ с lastOpen
    // точен до закрытия следующей свечи
    const key = `${coinId}|${interval}|${count}|${lastOpen}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const all = await this.fetch(
      coinId,
      interval,
      rangeStart - WARMUP * step,
      lastOpen,
    );
    const result = this.toSeries(all, rangeStart);
    const { candles } = result;

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

  // Свечи с разогревом → свечи от rangeStart и ряды по ним; индикаторы — по
  // всем close, разогрев отрезан по t
  private toSeries(all: Candle[], rangeStart: number): Computed {
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

    return { candles, series, closes };
  }
}
