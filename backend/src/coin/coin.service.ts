import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { COINS } from '../market/market.types';
import { COIN_TTL_MS, CoinFields } from './coin.types';
import { fetchMarkets } from './sources';

type Snapshot = Map<string, Omit<CoinFields, 'market'>>;

// Поля монеты (TASK-0010): один запрос CoinGecko на все монеты дашборда,
// снимок общий на 60 с — и с ошибкой. Источник один, отказ — 502 с текстом
// (его показывает фронт, api/errors.ts). В БД ничего не пишет.
@Injectable()
export class CoinService {
  private readonly logger = new Logger(CoinService.name);
  private snapshot: { at: number; value: Snapshot | Error } | null = null;
  // Запрос в полёте: параллельные вызовы при пустом кэше ждут один ответ
  private inflight: Promise<Snapshot | Error> | null = null;

  // Часы — поле, чтобы тест мог сдвинуть время (как DerivativesService)
  clock: () => number = Date.now;

  constructor(private http: HttpService) {}

  async get(coinId: string): Promise<CoinFields> {
    if (!Object.hasOwn(COINS, coinId)) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    const snap = await this.load();
    if (snap instanceof Error) throw new BadGatewayException(snap.message);
    const fields = snap.get(coinId);
    if (!fields) throw new BadGatewayException('CoinGecko не отдал монету');
    return { ...fields, market: COINS[coinId].market };
  }

  private load(): Promise<Snapshot | Error> {
    const now = this.clock();
    if (this.snapshot && now - this.snapshot.at < COIN_TTL_MS) {
      return Promise.resolve(this.snapshot.value);
    }
    if (this.inflight) return this.inflight;
    this.inflight = fetchMarkets(this.http, Object.keys(COINS))
      .then(
        (s): Snapshot | Error => s,
        (e: unknown): Error => {
          this.logger.error(
            `coins/markets: ${(e as Error)?.message ?? String(e)}`,
          );
          return new Error(
            isAxiosError(e) && e.response?.status === 429
              ? 'CoinGecko: превышен лимит запросов'
              : 'CoinGecko недоступен',
          );
        },
      )
      .then((value) => {
        // Время снимка — после ответа: медленный ответ не съедает TTL
        this.snapshot = { at: this.clock(), value };
        return value;
      })
      // В finally: бросок выше не оставит отклонённый промис навсегда
      // (критик T2)
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
