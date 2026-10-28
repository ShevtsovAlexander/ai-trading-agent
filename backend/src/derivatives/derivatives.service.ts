import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { fetchClosedCandles } from '../binance/klines';
import { COINS } from '../market/market.types';
import {
  DERIVATIVE_SYMBOLS,
  Derivatives,
  Exchange,
  ExchangeOpenInterest,
  FundingPayment,
  FundingView,
  OiStep,
  OpenInterestHistory,
  SourceError,
} from './derivatives.types';
import { OI_STEP_MS, OI_WINDOW_DAYS, buildOiSeries } from './oi-history';
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
// + запас на публикацию бирж; неполный (ошибка, точка ещё не вышла) — 60 с,
// как снимок с ошибками: повтор к упавшей бирже не на каждый опрос
export const OI_PUBLISH_MARGIN_MS = 2 * 60_000;
export const OI_RETRY_MS = 60_000;

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

  // Часы — поле, чтобы тест мог сдвинуть время
  clock: () => number = Date.now;

  constructor(private http: HttpService) {}

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
    step: string,
  ): Promise<OpenInterestHistory> {
    if (
      !Object.hasOwn(DERIVATIVE_SYMBOLS, coinId) ||
      !Object.hasOwn(COINS, coinId)
    ) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    if (!Object.hasOwn(OI_STEP_MS, step)) {
      throw new BadRequestException(`Неизвестный шаг: ${step} (1d или 1h)`);
    }
    const st = step as OiStep;
    const now = this.clock();
    const key = `${coinId}|${st}`;
    const cached = this.oiHistories.get(key);
    if (cached && now < cached.until) return cached.value;

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
      step: st,
      exchanges: (['binance', 'okx', 'bybit'] as const).map((exchange) =>
        down[exchange]
          ? { exchange, error: UNAVAILABLE[exchange] }
          : { exchange },
      ),
      priceError: spotDown ? 'Binance недоступен' : null,
      points,
    };

    // Полон — нет ошибок и последняя точка — последний момент сетки ≤ now:
    // новых данных до следующего момента не будет. Иначе повтор через 60 с
    const lastMoment = Math.floor(now / stepMs) * stepMs;
    const complete =
      !Object.values(down).some(Boolean) &&
      !spotDown &&
      points.at(-1)?.t === lastMoment;
    this.oiHistories.set(key, {
      until: complete
        ? lastMoment + stepMs + OI_PUBLISH_MARGIN_MS
        : now + OI_RETRY_MS,
      value,
    });
    return value;
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
