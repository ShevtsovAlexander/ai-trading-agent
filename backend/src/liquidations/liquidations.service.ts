import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { Exchange } from '../derivatives/derivatives.types';
import { COINS } from '../market/market.types';
import {
  LIQ_CLOSE_MARGIN_MS,
  LIQ_ERROR_TTL_MS,
  LIQ_PERIODS,
  LIQ_RETRY_AFTER_DEFAULT_S,
  LIQUIDATION_SYMBOLS,
  LiqPeriod,
  LiqPoint,
  Liquidations,
} from './liquidations.types';
import { buildLiqSeries, sumLast24h } from './series';
import { fetchLiquidations } from './sources';

const EXCHANGES: Exchange[] = ['binance', 'okx', 'bybit'];
const LIMIT_TEXT = 'Coinalyze: превышен лимит запросов';
const UNAVAILABLE_TEXT = 'Coinalyze недоступен';
const NO_KEY_TEXT =
  'Не задан ключ Coinalyze (COINALYZE_API_KEY в backend/.env)';

interface Series {
  points: LiqPoint[];
  missing: Exchange[]; // нет в ответе или пустой ряд
  settled: boolean; // false — источник мог ещё не дописать последнюю свечу
}
type Entry = { until: number; value: Series | Error };

// Ряд Coinalyze на монету и период в памяти: до закрытия следующей свечи,
// неполный и ошибка — на минуту. Один запрос в полёте на ключ, лимит (40 в
// минуту на ключ API) — общая пауза по Retry-After. Ключ — только в заголовке
// запроса; в журнал и ответы не попадает.
@Injectable()
export class LiquidationsService {
  private readonly logger = new Logger(LiquidationsService.name);
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Series | Error>>();
  private pausedUntil = 0;

  clock: () => number = Date.now;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async get(coinId: string, period: string): Promise<Liquidations> {
    if (
      !Object.hasOwn(LIQUIDATION_SYMBOLS, coinId) ||
      !Object.hasOwn(COINS, coinId)
    ) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    if (!Object.hasOwn(LIQ_PERIODS, period)) {
      throw new BadRequestException(
        `Неизвестный период: ${period} (1d, 1m или 1y)`,
      );
    }
    const p = period as LiqPeriod;
    const key = this.config.get<string>('COINALYZE_API_KEY')?.trim();
    if (!key) throw new BadGatewayException(NO_KEY_TEXT);

    // Сумма за 24 часа — всегда по 15 минутам: число не зависит от вкладки
    const [series, day] = await Promise.all([
      this.load(coinId, p, key),
      p === '1d' ? null : this.load(coinId, '1d', key),
    ]);
    const daySeries = day ?? series;
    if (series instanceof Error) throw new BadGatewayException(series.message);
    if (daySeries instanceof Error) {
      throw new BadGatewayException(daySeries.message);
    }

    const missing = new Set([...series.missing, ...daySeries.missing]);
    return {
      coinId,
      market: COINS[coinId].market,
      period: p,
      stepMs: LIQ_PERIODS[p].stepMs,
      exchanges: EXCHANGES.map((exchange) =>
        missing.has(exchange)
          ? { exchange, error: 'нет данных Coinalyze' }
          : { exchange },
      ),
      last24h: sumLast24h(daySeries.points, LIQ_PERIODS['1d'].stepMs),
      points: series.points,
    };
  }

  private load(
    coinId: string,
    period: LiqPeriod,
    key: string,
  ): Promise<Series | Error> {
    const id = `${coinId}|${period}`;
    const now = this.clock();
    const cached = this.cache.get(id);
    if (cached && now < cached.until) return Promise.resolve(cached.value);
    const pending = this.inflight.get(id);
    if (pending) return pending;
    if (now < this.pausedUntil) return Promise.resolve(new Error(LIMIT_TEXT));

    const { stepMs, bars, interval } = LIQ_PERIODS[period];
    const end = Math.floor((now - LIQ_CLOSE_MARGIN_MS) / stepMs) * stepMs; // открытие незакрытой
    const start = end - bars * stepMs;
    const symbols = LIQUIDATION_SYMBOLS[coinId];

    const p = fetchLiquidations(
      this.http,
      key,
      EXCHANGES.map((e) => symbols[e]),
      interval,
      start,
      end - stepMs,
    )
      .then((rows): Series => {
        const missing: Exchange[] = [];
        const present = EXCHANGES.flatMap((e) => {
          const row = rows.get(symbols[e]);
          if (!row || row.length === 0) {
            missing.push(e);
            return [];
          }
          return [row];
        });
        if (present.length === 0) throw new Error(UNAVAILABLE_TEXT);
        // Дневной ряд полон у каждой биржи (замер TASK-0015: 365 из 365), и
        // свежая свеча без записи — скорее недописанный день, чем затишье: иначе
        // неполный день прожил бы в кэше сутки. У коротких шагов пустая свеча —
        // обычное дело, такая проверка держала бы кэш на минуте постоянно
        const lastBar = end - stepMs;
        const settled =
          period !== '1y' ||
          present.every((row) => row.some((bar) => bar.t === lastBar));
        return {
          points: buildLiqSeries(start, stepMs, bars, present),
          missing,
          settled,
        };
      })
      .catch((e: unknown): Error => this.translate(id, e))
      .then((value) => {
        const at = this.clock();
        const complete =
          !(value instanceof Error) && !value.missing.length && value.settled;
        this.cache.set(id, {
          until: complete
            ? end + stepMs + LIQ_CLOSE_MARGIN_MS
            : Math.max(at + LIQ_ERROR_TTL_MS, this.pausedUntil),
          value,
        });
        return value;
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  // В журнал — только код и текст: у ошибки axios в config лежат заголовки с ключом
  private translate(id: string, e: unknown): Error {
    const status = isAxiosError(e) ? e.response?.status : undefined;
    this.logger.warn(
      `Coinalyze ${id}: ${status ?? (e as Error)?.message ?? 'отказ'}`,
    );
    if (status === 401 || status === 403) {
      return new Error('Coinalyze отклонил ключ');
    }
    if (status === 429) {
      const header: unknown = isAxiosError(e)
        ? e.response?.headers?.['retry-after']
        : undefined;
      const wait = Number(header);
      // Поздний ответ не сокращает уже назначенную паузу
      this.pausedUntil = Math.max(
        this.pausedUntil,
        this.clock() +
          (Number.isFinite(wait) && wait > 0
            ? wait
            : LIQ_RETRY_AFTER_DEFAULT_S) *
            1000,
      );
      return new Error(LIMIT_TEXT);
    }
    return new Error(UNAVAILABLE_TEXT);
  }
}
