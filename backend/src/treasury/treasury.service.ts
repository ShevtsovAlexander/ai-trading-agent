import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { CoinService } from '../coin/coin.service';
import { COINS } from '../market/market.types';
import { ParsedTreasury, fetchTreasury } from './sources';
import {
  TREASURY_ERROR_TTL_MS,
  TREASURY_TTL_MS,
  Treasury,
} from './treasury.types';

type Entry = {
  at: number;
  value: (ParsedTreasury & { fetchedAt: number }) | Error;
};

// Снимок по монете: успех — на час, ошибка — на минуту (лимит CoinGecko без
// ключа общий с «Монетой»). Пока снимка нет, параллельные вызовы ждут один
// запрос. Доля — от «в обращении» CoinService (тот же знаменатель, что
// карточка «Монета»); упал он — доля null, держания всё равно отдаются.
@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);
  private readonly snapshots = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry['value']>>();

  clock: () => number = Date.now;

  constructor(
    private readonly http: HttpService,
    private readonly coin: CoinService,
  ) {}

  async get(coinId: string): Promise<Treasury> {
    if (!Object.hasOwn(COINS, coinId)) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    const snap = await this.load(coinId);
    if (snap instanceof Error) throw new BadGatewayException(snap.message);

    let share: number | null = null;
    try {
      const fields = await this.coin.get(coinId);
      share = parseFloat(
        ((snap.totalHoldings / fields.circulating) * 100).toFixed(2),
      );
    } catch (e) {
      this.logger.warn(`Доля держателей ${coinId}: ${String(e)}`);
    }
    return {
      coinId,
      market: COINS[coinId].market,
      totalHoldings: snap.totalHoldings,
      totalValueUsd: snap.totalValueUsd,
      companies: snap.companies,
      shareOfCirculatingPct: share,
      top: snap.top,
      fetchedAt: snap.fetchedAt,
    };
  }

  private load(coinId: string): Promise<Entry['value']> {
    const now = this.clock();
    const s = this.snapshots.get(coinId);
    if (s) {
      const ttl =
        s.value instanceof Error ? TREASURY_ERROR_TTL_MS : TREASURY_TTL_MS;
      if (now - s.at < ttl) return Promise.resolve(s.value);
    }
    const pending = this.inflight.get(coinId);
    if (pending) return pending;

    const p = fetchTreasury(this.http, coinId)
      .then(
        (parsed): Entry['value'] => ({ ...parsed, fetchedAt: this.clock() }),
        (e: unknown): Entry['value'] => {
          this.logger.warn(`CoinGecko treasury ${coinId}: ${String(e)}`);
          const status = isAxiosError(e) ? e.response?.status : undefined;
          return new Error(
            status === 429
              ? 'CoinGecko: превышен лимит запросов'
              : 'CoinGecko недоступен',
          );
        },
      )
      .then((value) => {
        // Время снимка — после ответа (как CoinService)
        this.snapshots.set(coinId, { at: this.clock(), value });
        return value;
      })
      .finally(() => this.inflight.delete(coinId));
    this.inflight.set(coinId, p);
    return p;
  }
}
