import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { fetchClosedCandles } from '../binance/klines';
import { LIQUIDATION_SYMBOLS } from '../liquidations/liquidations.types';
import { COINS, Candle } from '../market/market.types';
import {
  DERIVATIVE_SYMBOLS,
  Derivatives,
  Exchange,
  ExchangeOpenInterest,
  FundingPayment,
  FundingView,
  OiPeriod,
  OiStep,
  OpenInterestHistory,
  SourceError,
} from './derivatives.types';
import {
  OI_STEP_MS,
  OI_WINDOW_DAYS,
  OKX_SETTLE_MS,
  buildOiSeries,
} from './oi-history';
import {
  OI_LONG_FROM,
  OiBar,
  buildOiLongSeries,
  fetchOiHistoryCoinalyze,
} from './oi-long';
import {
  fetchFunding,
  fetchFundingHistory,
  fetchMarkBybit,
  fetchOiHistoryBinance,
  fetchOiHistoryBybit,
  fetchOiHistoryOkx,
  fetchOpenInterestBinance,
  fetchOpenInterestBybit,
  fetchOpenInterestOkx,
  OpenInterest,
} from './sources';
import { STRESS_PERIOD_DAYS, fundingStress } from './stress';

// Снимок ставки и OI живёт 30 с: опросы нескольких вкладок не множат
// запросы к трём биржам (план TASK-0007, «Поток данных»). Два get() одной
// монеты одновременно оба идут к биржам — кэш не портится, при опросе раз
// в 60 с принято (решение человека, критик T4)
export const SNAPSHOT_TTL_MS = 30_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// Историю берём на день глубже окна: у первой выплаты окна должна быть
// предыдущая, иначе её шаг не проверить (stress.ts)
const HISTORY_DAYS = STRESS_PERIOD_DAYS + 1;

// История OI (TASK-0008): полный ряд держится до следующего момента сетки
// + выдержка OKX — раньше новая точка в ряд не попадёт, запросы впустую
// (критик T4); неполный (ошибка, дыра, точка ещё не вышла) — 60 с, как
// снимок с ошибками: повтор к упавшей бирже не на каждый опрос
export const OI_PUBLISH_MARGIN_MS = OKX_SETTLE_MS;
export const OI_RETRY_MS = 60_000;

// OI 1Г и «Всё» (TASK-0017): тексты и пауза — как у ликвидаций
// (liquidations.service.ts), пауза своя: OI добавляет ≤ 3 запроса в сутки
// (план TASK-0017, trade-off 3)
const OI_PERIODS: OiPeriod[] = ['30d', '1y', 'all'];
const EXCHANGES: Exchange[] = ['binance', 'okx', 'bybit'];
const NO_KEY_TEXT =
  'Не задан ключ Coinalyze (COINALYZE_API_KEY в backend/.env)';
const LIMIT_TEXT = 'Coinalyze: превышен лимит запросов';
const COINALYZE_DOWN = 'Coinalyze недоступен';
const NO_DATA_TEXT = 'нет данных Coinalyze';
export const COINALYZE_RETRY_AFTER_DEFAULT_S = 60;

// Ряд Coinalyze монеты (на 1Г и «Всё» один) и дневной спот к нему
interface LongRows {
  rows: Partial<Record<Exchange, OiBar[]>>;
  missing: Exchange[]; // нет в ответе или ряд пуст
}
type Kept<T> = { until: number; value: T | Error };

const UNAVAILABLE: Record<Exchange, string> = {
  binance: 'Binance недоступен',
  okx: 'OKX недоступен',
  bybit: 'Bybit недоступен',
};

// Деривативы монеты: ставка Binance с мерой необычности и OI трёх бирж.
// Источники опрашиваются независимо (allSettled): отказ одной биржи —
// текст в её поле, остальное на месте. В БД ничего не пишет.
@Injectable()
export class DerivativesService {
  private readonly logger = new Logger(DerivativesService.name);
  private readonly snapshots = new Map<
    string,
    { at: number; value: Derivatives }
  >();
  // История меняется только на выплате — держим до nextFundingTime
  private readonly histories = new Map<
    string,
    { until: number; payments: FundingPayment[] }
  >();
  private readonly oiHistories = new Map<
    string,
    { until: number; value: OpenInterestHistory }
  >();
  private readonly longRows = new Map<string, Kept<LongRows>>();
  private readonly longSpot = new Map<string, Kept<Candle[]>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private coinalyzePausedUntil = 0;

  // Часы — поле, чтобы тест мог сдвинуть время
  clock: () => number = Date.now;

  constructor(
    private http: HttpService,
    private config: ConfigService,
  ) {}

  async get(coinId: string): Promise<Derivatives> {
    // Ключи двух словарей — один список монет; проверка по обоим, чтобы
    // их расхождение дало 400, а не TypeError (критик T4)
    if (
      !Object.hasOwn(DERIVATIVE_SYMBOLS, coinId) ||
      !Object.hasOwn(COINS, coinId)
    ) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    const now = this.clock();
    const cached = this.snapshots.get(coinId);
    if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.value;

    const symbols = DERIVATIVE_SYMBOLS[coinId];
    // OI Binance — в монетах, переводится по markPrice из того же
    // premiumIndex: без ставки нет и его (план, «Контракты»)
    const funding = fetchFunding(this.http, symbols.binance);
    const [fundingR, historyR, binanceR, okxR, bybitR] =
      await Promise.allSettled([
        funding,
        this.history(coinId, symbols.binance, now),
        funding.then((f) =>
          fetchOpenInterestBinance(this.http, symbols.binance, f.markPrice),
        ),
        fetchOpenInterestOkx(this.http, symbols.okx),
        fetchOpenInterestBybit(this.http, symbols.bybit),
      ]);

    let fundingView: FundingView | SourceError;
    if (fundingR.status === 'fulfilled') {
      const f = fundingR.value;
      if (historyR.status === 'fulfilled') {
        this.keepHistory(coinId, historyR.value, f.nextFundingTime);
      } else {
        this.fail(coinId, 'история funding', historyR.reason);
      }
      fundingView = {
        exchange: 'binance',
        rate: f.rate,
        nextFundingTime: f.nextFundingTime,
        at: f.at,
        stress:
          historyR.status === 'fulfilled'
            ? fundingStress(historyR.value, f.rate, f.nextFundingTime, now)
            : null,
      };
    } else {
      this.fail(coinId, 'funding Binance', fundingR.reason);
      fundingView = { error: UNAVAILABLE.binance };
    }

    const exchanges: ExchangeOpenInterest[] = (
      [
        ['binance', binanceR],
        ['okx', okxR],
        ['bybit', bybitR],
      ] as const
    ).map(([exchange, r]: [Exchange, PromiseSettledResult<OpenInterest>]) => {
      if (r.status === 'fulfilled') return { exchange, ...r.value };
      // Binance OI без ставки — причина уже записана в лог выше
      if (exchange !== 'binance' || fundingR.status === 'fulfilled') {
        this.fail(coinId, `OI ${exchange}`, r.reason);
      }
      return { exchange, error: UNAVAILABLE[exchange] };
    });
    const ok = exchanges.flatMap((e) => ('usd' in e ? [e.usd] : []));

    const value: Derivatives = {
      coinId,
      market: COINS[coinId].market,
      funding: fundingView,
      openInterest: {
        totalUsd: ok.length > 0 ? ok.reduce((a, b) => a + b, 0) : null,
        exchanges,
      },
    };
    // Кэшируется и ответ с ошибками: повтор к упавшей бирже — через 30 с,
    // а не на каждый опрос
    this.snapshots.set(coinId, { at: now, value });
    return value;
  }

  // Ряд OI трёх бирж за 30 дней и цена спота Binance (TASK-0008). Пять
  // источников независимы (allSettled): отказ биржи — текст в её поле, биржа
  // выпадает из суммы всех точек; Bybit без своей mark в USD не перевести —
  // упал любой из двух его запросов, Bybit целиком «недоступен». Сборка —
  // buildOiSeries (сдвиг меток OKX, окно, дыры).
  async openInterestHistory(
    coinId: string,
    step: string | undefined,
    period: string = '30d',
  ): Promise<OpenInterestHistory> {
    if (
      !Object.hasOwn(DERIVATIVE_SYMBOLS, coinId) ||
      !Object.hasOwn(COINS, coinId)
    ) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    if (!OI_PERIODS.includes(period as OiPeriod)) {
      throw new BadRequestException(
        `Неизвестный период: ${period} (30d, 1y или all)`,
      );
    }
    if (period !== '30d') {
      if (step === '1h') {
        throw new BadRequestException('Почасовой шаг — только 30 дней');
      }
      if (step !== undefined && step !== '1d') {
        throw new BadRequestException(`Неизвестный шаг: ${step} (1d или 1h)`);
      }
      // Символы Coinalyze — таблица ликвидаций: монеты нет в ней — 400, а не
      // ложное «Coinalyze недоступен» (критик 17.3)
      if (!Object.hasOwn(LIQUIDATION_SYMBOLS, coinId)) {
        throw new BadRequestException(`Нет символов Coinalyze: ${coinId}`);
      }
      return this.openInterestLong(coinId, period as '1y' | 'all');
    }
    if (step === undefined || !Object.hasOwn(OI_STEP_MS, step)) {
      throw new BadRequestException(`Неизвестный шаг: ${step} (1d или 1h)`);
    }
    const st = step as OiStep;
    const now = this.clock();
    const key = `${coinId}|${st}`;
    const cached = this.oiHistories.get(key);
    // Ключ читается на каждый ответ: его наличие не кэшируется вместе с рядом
    if (cached && now < cached.until) {
      return { ...cached.value, longAvailable: this.hasKey() };
    }

    const stepMs = OI_STEP_MS[st];
    const daily = st === '1d';
    // Шаг запаса слева: у OKX момент первой точки окна — метка на шаг раньше
    const from = now - OI_WINDOW_DAYS * DAY_MS - stepMs;
    const symbols = DERIVATIVE_SYMBOLS[coinId];
    const [binanceR, okxR, bybitR, markR, spotR] = await Promise.allSettled([
      fetchOiHistoryBinance(this.http, symbols.binance, st, from),
      fetchOiHistoryOkx(this.http, symbols.okx, daily ? '1Dutc' : '1H', from),
      fetchOiHistoryBybit(this.http, symbols.bybit, st, from),
      fetchMarkBybit(this.http, symbols.bybit, daily ? 'D' : '60', from, now),
      // Свеча, открытая в t − шаг, закрылась в t — её close и есть цена в t;
      // первый момент окна > now − 30 дн, значит его свеча открыта после from
      fetchClosedCandles(this.http, COINS[coinId].symbol, st, from, now, now),
    ]);

    const failed = (what: string, r: PromiseSettledResult<unknown>) => {
      if (r.status === 'rejected') this.fail(coinId, `${what} ${st}`, r.reason);
      return r.status === 'rejected';
    };
    const binanceDown = failed('история OI binance', binanceR);
    const okxDown = failed('история OI okx', okxR);
    const bybitDown = failed('история OI bybit', bybitR);
    const markDown = failed('mark bybit', markR);
    const spotDown = failed('спот', spotR);

    const points = buildOiSeries({
      step: st,
      now,
      binance: binanceR.status === 'fulfilled' ? binanceR.value : null,
      okx: okxR.status === 'fulfilled' ? okxR.value : null,
      bybit:
        bybitR.status === 'fulfilled' && markR.status === 'fulfilled'
          ? { rows: bybitR.value, marks: markR.value }
          : null,
      spot: spotR.status === 'fulfilled' ? spotR.value.candles : null,
    });
    const down: Record<Exchange, boolean> = {
      binance: binanceDown,
      okx: okxDown,
      bybit: bybitDown || markDown,
    };
    const value: OpenInterestHistory = {
      coinId,
      market: COINS[coinId].market,
      period: '30d',
      step: st,
      source: 'exchanges',
      longAvailable: this.hasKey(),
      exchanges: (['binance', 'okx', 'bybit'] as const).map((exchange) =>
        down[exchange]
          ? { exchange, error: UNAVAILABLE[exchange] }
          : { exchange },
      ),
      priceError: spotDown ? 'Binance недоступен' : null,
      points,
    };

    // Полон — нет ошибок, последняя точка — последний момент сетки ≤ now и
    // дыр нет (все 30 дн. / шаг моментов окна): новых данных до следующего
    // момента не будет. Иначе повтор через 60 с — дыра от сбойной строки
    // (0 у OKX, замер T4) не закрепляется на час
    const lastMoment = Math.floor(now / stepMs) * stepMs;
    const complete =
      !Object.values(down).some(Boolean) &&
      !spotDown &&
      points.at(-1)?.t === lastMoment &&
      points.length === (OI_WINDOW_DAYS * DAY_MS) / stepMs;
    this.oiHistories.set(key, {
      until: complete
        ? lastMoment + stepMs + OI_PUBLISH_MARGIN_MS
        : now + OI_RETRY_MS,
      value,
    });
    return value;
  }

  // 1Г и «Всё» — один ряд Coinalyze на монету и дневной спот Binance, у
  // каждого свой кэш: упал спот — повтор к Binance, а не к лимиту Coinalyze.
  // Ряд полон (все три биржи, последний момент — сегодня 00:00 UTC) — до
  // следующего момента + 10 мин (OI_PUBLISH_MARGIN_MS); иначе и ошибка — 60 с
  private async openInterestLong(
    coinId: string,
    period: '1y' | 'all',
  ): Promise<OpenInterestHistory> {
    const key = this.config.get<string>('COINALYZE_API_KEY')?.trim();
    if (!key) throw new BadGatewayException(NO_KEY_TEXT);
    const [rows, spot] = await Promise.all([
      this.loadLongRows(coinId, key),
      this.loadLongSpot(coinId),
    ]);
    if (rows instanceof Error) throw new BadGatewayException(rows.message);

    const now = this.clock();
    const points = buildOiLongSeries({
      period,
      now,
      rows: rows.rows,
      spot: spot instanceof Error ? null : spot,
    });
    return {
      coinId,
      market: COINS[coinId].market,
      period,
      step: '1d',
      source: 'coinalyze',
      longAvailable: true,
      exchanges: EXCHANGES.map((exchange) =>
        rows.missing.includes(exchange)
          ? { exchange, error: NO_DATA_TEXT }
          : { exchange },
      ),
      priceError: spot instanceof Error ? spot.message : null,
      points,
    };
  }

  // Последний момент сетки дня, уже наступивший: сегодня 00:00 UTC
  private lastDay(now: number): number {
    return Math.floor(now / DAY_MS) * DAY_MS;
  }

  private keep<T>(
    cache: Map<string, Kept<T>>,
    id: string,
    load: (now: number) => Promise<T>,
    complete: (value: T, now: number) => boolean,
    paused?: (now: number) => Error | null,
  ): Promise<T | Error> {
    const now = this.clock();
    const cached = cache.get(id);
    if (cached && now < cached.until) return Promise.resolve(cached.value);
    const pending = this.inflight.get(id) as Promise<T | Error> | undefined;
    if (pending) return pending;
    // Пауза по лимиту — до запроса и без записи в кэш: иначе отказ прожил бы
    // ещё 60 с после её конца (как liquidations.service.ts)
    const blocked = paused?.(now);
    if (blocked) return Promise.resolve(blocked);
    const p = load(now)
      .catch((e: unknown): Error => this.translateLong(id, e))
      .then((value) => {
        const full = !(value instanceof Error) && complete(value, now);
        cache.set(id, {
          until: full
            ? this.lastDay(now) + DAY_MS + OI_PUBLISH_MARGIN_MS
            : this.clock() + OI_RETRY_MS,
          value,
        });
        return value;
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private loadLongRows(coinId: string, key: string): Promise<LongRows | Error> {
    const symbols = LIQUIDATION_SYMBOLS[coinId];
    return this.keep(
      this.longRows,
      `coinalyze|${coinId}`,
      async (now) => {
        const parsed = await fetchOiHistoryCoinalyze(
          this.http,
          key,
          EXCHANGES.map((e) => symbols[e]),
          OI_LONG_FROM,
          now,
        );
        const rows: Partial<Record<Exchange, OiBar[]>> = {};
        const missing: Exchange[] = [];
        for (const e of EXCHANGES) {
          const bars = parsed.get(symbols[e]);
          // Ряд без единого наступившего момента (пуст, одни нули, только
          // живой день) — тоже отказ биржи: иначе она «ответила» и обнулила
          // все точки, а пометки не было бы (критик 17.2)
          if (bars?.some((b) => b.t >= OI_LONG_FROM && b.t + DAY_MS <= now)) {
            rows[e] = bars;
          } else missing.push(e);
        }
        if (missing.length === EXCHANGES.length) {
          throw new Error(COINALYZE_DOWN);
        }
        return { rows, missing };
      },
      (value, now) =>
        value.missing.length === 0 &&
        EXCHANGES.every((e) => this.dense(value.rows[e]!, now)),
      (now) => (now < this.coinalyzePausedUntil ? new Error(LIMIT_TEXT) : null),
    );
  }

  private loadLongSpot(coinId: string): Promise<Candle[] | Error> {
    return this.keep(
      this.longSpot,
      `spot|${coinId}`,
      async (now) =>
        (
          await fetchClosedCandles(
            this.http,
            COINS[coinId].symbol,
            '1d',
            OI_LONG_FROM,
            now,
            now,
          )
        ).candles,
      (candles, now) => candles.at(-1)?.t === this.lastDay(now) - DAY_MS,
    );
  }

  // Ряд биржи без дыр от OI_LONG_FROM до вчерашнего бара включительно: как
  // полнота 30 дней по числу точек (план «Кэш», критик 17.3). В замере research
  // дыр нет ни у одного из девяти рядов; сбойный 0 в середине — повтор раз в 60 с
  private dense(bars: OiBar[], now: number): boolean {
    const last = this.lastDay(now) - DAY_MS; // метка вчерашнего бара
    const days = new Set(
      bars.filter((b) => b.t >= OI_LONG_FROM && b.t <= last).map((b) => b.t),
    );
    return days.size === (last - OI_LONG_FROM) / DAY_MS + 1;
  }

  private hasKey(): boolean {
    return !!this.config.get<string>('COINALYZE_API_KEY')?.trim();
  }

  // В журнал — только код и текст: у ошибки axios в config лежат заголовки с
  // ключом. Спот — свои тексты: это Binance, не Coinalyze
  private translateLong(id: string, e: unknown): Error {
    const status = isAxiosError(e) ? e.response?.status : undefined;
    const message = (e as Error)?.message;
    this.logger.warn(`${id}: ${status ?? message ?? 'отказ'}`);
    if (id.startsWith('spot|')) return new Error('Binance недоступен');
    if (message === COINALYZE_DOWN) return new Error(message);
    if (status === 401 || status === 403) {
      return new Error('Coinalyze отклонил ключ');
    }
    if (status === 429) {
      const wait = Number(
        isAxiosError(e) ? e.response?.headers?.['retry-after'] : undefined,
      );
      // Поздний ответ не сокращает уже назначенную паузу
      this.coinalyzePausedUntil = Math.max(
        this.coinalyzePausedUntil,
        this.clock() +
          (Number.isFinite(wait) && wait > 0
            ? wait
            : COINALYZE_RETRY_AFTER_DEFAULT_S) *
            1000,
      );
      return new Error(LIMIT_TEXT);
    }
    return new Error(COINALYZE_DOWN);
  }

  private history(
    coinId: string,
    symbol: string,
    now: number,
  ): Promise<FundingPayment[]> {
    const cached = this.histories.get(coinId);
    if (cached && now < cached.until) return Promise.resolve(cached.payments);
    return fetchFundingHistory(
      this.http,
      symbol,
      now - HISTORY_DAYS * DAY_MS,
      now,
    );
  }

  // Кэш истории — до следующей выплаты, и только если последняя выплата
  // уже в ней: сразу после выплаты Binance может ещё не отдать новую запись,
  // и неполная история прожила бы целый интервал (как кэш свечей,
  // market-data.service.ts). Признак полноты — шаг «последняя → следующая»
  // равен шагу двух последних выплат: порог «≤ 8,5 ч» пропускал пропуск
  // при интервале 4 ч (критик T4). Смена интервала — тоже без кэша: история
  // спрашивается заново раз в 30 с, пока шаги не сравняются.
  private keepHistory(
    coinId: string,
    payments: FundingPayment[],
    nextFundingTime: number,
  ): void {
    if (payments.length < 2) return;
    const last = payments[payments.length - 1].t;
    const prev = payments[payments.length - 2].t;
    const hours = (ms: number) => Math.round(ms / HOUR_MS);
    if (hours(nextFundingTime - last) !== hours(last - prev)) return;
    this.histories.set(coinId, { until: nextFundingTime, payments });
  }

  private fail(coinId: string, what: string, reason: unknown): void {
    this.logger.error(
      `${coinId} ${what}: ${(reason as Error)?.message ?? String(reason)}`,
    );
  }
}
