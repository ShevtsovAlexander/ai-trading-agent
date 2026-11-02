import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { COINS } from '../market/market.types';
import {
  BUCKET_STEP,
  Book,
  BookExchange,
  ExchangeState,
  ORDERBOOK_SYMBOLS,
  OrderBookSnapshot,
  SNAPSHOT_TTL_MS,
  WALLS_PER_SIDE,
} from './orderbook.types';
import { fetchBookOkx, fetchDepthBinance } from './sources';
import { buildWalls } from './walls';

const UNAVAILABLE: Record<BookExchange, string> = {
  binance: 'Binance недоступен',
  okx: 'OKX недоступен',
};

// Стакан спота монеты: Binance + OKX одной суммой по ступеням (план
// TASK-0009, «Поток данных»). Биржи опрашиваются независимо (allSettled):
// отказ одной — текст в её поле, стены по другой. В БД ничего не пишет.
@Injectable()
export class OrderbookService {
  private readonly logger = new Logger(OrderbookService.name);
  private readonly snapshots = new Map<
    string,
    { at: number; value: OrderBookSnapshot }
  >();

  // Часы — поле, чтобы тест мог сдвинуть время (как DerivativesService)
  clock: () => number = Date.now;

  constructor(private http: HttpService) {}

  async get(coinId: string): Promise<OrderBookSnapshot> {
    // Ключи двух словарей — один список монет; проверка по обоим, чтобы
    // их расхождение дало 400, а не TypeError (как деривативы)
    if (
      !Object.hasOwn(ORDERBOOK_SYMBOLS, coinId) ||
      !Object.hasOwn(COINS, coinId)
    ) {
      throw new BadRequestException(`Неизвестная монета: ${coinId}`);
    }
    const now = this.clock();
    const cached = this.snapshots.get(coinId);
    if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.value;

    const symbols = ORDERBOOK_SYMBOLS[coinId];
    const [binanceR, okxR] = await Promise.allSettled([
      fetchDepthBinance(this.http, symbols.binance, this.clock),
      fetchBookOkx(this.http, symbols.okx),
    ]);
    const at = this.clock();

    const books: Record<BookExchange, Book | null> = {
      binance: null,
      okx: null,
    };
    const exchanges: ExchangeState[] = (
      [
        ['binance', binanceR],
        ['okx', okxR],
      ] as const
    ).map(([exchange, r]: [BookExchange, PromiseSettledResult<Book>]) => {
      if (r.status === 'fulfilled') {
        books[exchange] = r.value;
        return { exchange, at: r.value.at };
      }
      this.logger.error(
        `${coinId} стакан ${exchange}: ${(r.reason as Error)?.message ?? String(r.reason)}`,
      );
      return { exchange, error: UNAVAILABLE[exchange] };
    });

    const step = BUCKET_STEP[coinId];
    const walls =
      books.binance || books.okx
        ? buildWalls({ ...books, step, n: WALLS_PER_SIDE })
        : null;
    const value: OrderBookSnapshot = {
      coinId,
      market: COINS[coinId].market,
      at,
      mid: walls?.mid ?? null,
      step,
      coverage: walls?.coverage ?? null,
      exchanges,
      bids: walls?.bids ?? [],
      asks: walls?.asks ?? [],
    };
    // Кэш — по моменту запроса (now), как деривативы
    this.snapshots.set(coinId, { at: now, value });
    return value;
  }
}
