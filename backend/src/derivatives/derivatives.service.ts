import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { COINS } from '../market/market.types';
import {
  DERIVATIVE_SYMBOLS,
  Derivatives,
  Exchange,
  ExchangeOpenInterest,
  FundingPayment,
  FundingView,
  SourceError,
} from './derivatives.types';
import {
  fetchFunding,
  fetchFundingHistory,
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
