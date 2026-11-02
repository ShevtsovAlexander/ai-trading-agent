import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { OrderbookModule } from './orderbook.module';
import { OrderbookService } from './orderbook.service';
import {
  BOOK_TIMEOUT_MS,
  BUCKET_STEP,
  BookExchange,
  ORDERBOOK_SYMBOLS,
  SNAPSHOT_TTL_MS,
  WALLS_PER_SIDE,
} from './orderbook.types';
import { fetchBookOkx, fetchDepthBinance } from './sources';
import { buildWalls } from './walls';

// Оракул: ответ сервиса = buildWalls на тех же сырых ответах фикстуры
// (buildWalls сверен с эталоном Python в walls.spec); кэш — известный ответ
// (число запросов к фейку). Отказы — как в жизни: Binance — ошибка сети,
// OKX — HTTP 200 с code 51001 в теле (фикстура errors).
type Raw = Record<string, any>;
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return --
   поля фикстуры — сырой JSON бирж */
const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'books-2026-11-02.json'), 'utf8'),
) as { binance: Raw; okx: Raw; errors: { binance: Raw; okx: Raw } };

const NOW = 1_793_617_447_000;
const COINS = ['bitcoin', 'ethereum', 'solana'];

const fakeHttp = () => {
  const calls: Record<BookExchange, Raw[]> = { binance: [], okx: [] };
  const fail = new Set<BookExchange>();
  const http = {
    get: (url: string, { params }: { params: Raw }) => {
      const ex: BookExchange = url.includes('okx') ? 'okx' : 'binance';
      calls[ex].push({ url, ...params });
      if (fail.has(ex)) {
        return ex === 'binance'
          ? throwError(() => new Error('binance: ECONNREFUSED'))
          : of({ data: FX.errors.okx, headers: {} });
      }
      const data =
        ex === 'binance'
          ? FX.binance[params.symbol as string]
          : FX.okx[params.instId as string];
      return of({ data, headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls, fail };
};

const setup = () => {
  const fake = fakeHttp();
  const service = new OrderbookService(fake.http);
  let t = NOW;
  service.clock = () => t;
  return { ...fake, service, at: (ms: number) => (t = ms) };
};

// Стаканы тех же ответов, разобранные кодом T1 (сверен с сырыми полями)
const replying = (data: unknown) =>
  ({ get: () => of({ data, headers: {} }) }) as unknown as HttpService;
const expectedWalls = async (
  coin: string,
  use: { binance: boolean; okx: boolean },
) => {
  const s = ORDERBOOK_SYMBOLS[coin];
  return buildWalls({
    binance: use.binance
      ? await fetchDepthBinance(
          replying(FX.binance[s.binance]),
          s.binance,
          () => NOW,
        )
      : null,
    okx: use.okx ? await fetchBookOkx(replying(FX.okx[s.okx]), s.okx) : null,
    step: BUCKET_STEP[coin],
    n: WALLS_PER_SIDE,
  });
};
const okxTs = (coin: string) =>
  Number(FX.okx[ORDERBOOK_SYMBOLS[coin].okx].data[0].ts);

describe.each(COINS)('OrderbookService %s', (coin) => {
  const s = ORDERBOOK_SYMBOLS[coin];

  it('обе биржи: стены = buildWalls на тех же ответах', async () => {
    const { service, calls } = setup();
    const r = await service.get(coin);
    const w = await expectedWalls(coin, { binance: true, okx: true });
    expect(r).toEqual({
      coinId: coin,
      market: `${s.binance.replace('USDT', '')}/USDT`,
      at: NOW,
      mid: w.mid,
      step: BUCKET_STEP[coin],
      coverage: w.coverage,
      exchanges: [
        { exchange: 'binance', at: NOW },
        { exchange: 'okx', at: okxTs(coin) },
      ],
      bids: w.bids,
      asks: w.asks,
    });
    expect(r.bids).toHaveLength(WALLS_PER_SIDE);
    expect(calls).toEqual({
      binance: [
        {
          url: 'https://api.binance.com/api/v3/depth',
          symbol: s.binance,
          limit: 5000,
        },
      ],
      okx: [
        {
          url: 'https://www.okx.com/api/v5/market/books-full',
          instId: s.okx,
          sz: 5000,
        },
      ],
    });
  });

  it.each([
    ['binance', 'okx'],
    ['okx', 'binance'],
  ] as const)('%s упал: ошибка в его поле, стены по %s', async (down, up) => {
    const { service, fail } = setup();
    fail.add(down);
    const r = await service.get(coin);
    const w = await expectedWalls(coin, {
      binance: up === 'binance',
      okx: up === 'okx',
    });
    expect(r.exchanges).toEqual([
      down === 'binance'
        ? { exchange: 'binance', error: 'Binance недоступен' }
        : { exchange: 'binance', at: NOW },
      down === 'okx'
        ? { exchange: 'okx', error: 'OKX недоступен' }
        : { exchange: 'okx', at: okxTs(coin) },
    ]);
    expect([r.mid, r.coverage, r.bids, r.asks]).toEqual([
      w.mid,
      w.coverage,
      w.bids,
      w.asks,
    ]);
  });

  it('обе упали: пустые стороны, mid и охват null, не исключение', async () => {
    const { service, fail } = setup();
    fail.add('binance').add('okx');
    const r = await service.get(coin);
    expect(r).toMatchObject({
      coinId: coin,
      at: NOW,
      mid: null,
      coverage: null,
      bids: [],
      asks: [],
      exchanges: [
        { exchange: 'binance', error: 'Binance недоступен' },
        { exchange: 'okx', error: 'OKX недоступен' },
      ],
    });
  });
});

describe('OrderbookService: кэш 15 с', () => {
  const count = (calls: Record<BookExchange, Raw[]>) => [
    calls.binance.length,
    calls.okx.length,
  ];

  it('повтор до 15 с — без запросов, ровно в 15 с — новые', async () => {
    const { service, calls, at } = setup();
    const first = await service.get('bitcoin');
    at(NOW + SNAPSHOT_TTL_MS - 1);
    expect(await service.get('bitcoin')).toBe(first);
    expect(count(calls)).toEqual([1, 1]);
    at(NOW + SNAPSHOT_TTL_MS);
    const second = await service.get('bitcoin');
    expect(count(calls)).toEqual([2, 2]);
    expect(second.at).toBe(NOW + SNAPSHOT_TTL_MS);
  });

  it('ответ с ошибкой тоже кэшируется: к упавшей бирже не чаще раза в 15 с', async () => {
    const { service, calls, fail, at } = setup();
    fail.add('okx');
    await service.get('ethereum');
    fail.delete('okx');
    at(NOW + SNAPSHOT_TTL_MS - 1);
    const r = await service.get('ethereum');
    expect(r.exchanges[1]).toEqual({
      exchange: 'okx',
      error: 'OKX недоступен',
    });
    expect(count(calls)).toEqual([1, 1]);
    at(NOW + SNAPSHOT_TTL_MS);
    const again = await service.get('ethereum');
    expect(again.exchanges[1]).toEqual({
      exchange: 'okx',
      at: okxTs('ethereum'),
    });
    expect(count(calls)).toEqual([2, 2]);
  });

  it('кэш — свой у каждой монеты', async () => {
    const { service, calls } = setup();
    await service.get('bitcoin');
    await service.get('solana');
    expect(calls.binance.map((c) => c.symbol)).toEqual(['BTCUSDT', 'SOLUSDT']);
    expect(calls.okx.map((c) => c.instId)).toEqual(['BTC-USDT', 'SOL-USDT']);
  });
});

describe('OrderbookService: время снимка', () => {
  it('at — часы после ответа обеих бирж, не момент запроса', async () => {
    // Часы идут на 1 мс за каждый взгляд: запрос, Binance после ответа, снимок
    const { service } = setup();
    let t = NOW;
    service.clock = () => t++;
    const r = await service.get('bitcoin');
    expect(r.exchanges[0]).toEqual({ exchange: 'binance', at: NOW + 1 });
    expect(r.at).toBe(NOW + 2);
  });
});

describe('OrderbookService: монета', () => {
  it.each(['dogecoin', '', 'constructor', '__proto__'])(
    '«%s» — 400, к биржам не ходит',
    async (coin) => {
      const { service, calls } = setup();
      await expect(service.get(coin)).rejects.toThrow(BadRequestException);
      expect([calls.binance, calls.okx]).toEqual([[], []]);
    },
  );
});

// Решение человека по критику T3: зависшая биржа не вешает маршрут.
// Известный ответ — HTTP-клиент сервиса из настоящего модуля ждёт ≤ 10 с
// (что axios по нему обрывает запрос — замер на зависшем сервере, итог T3)
describe('OrderbookModule: таймаут бирж', () => {
  it('HTTP-клиент сервиса — с таймаутом 10 с', async () => {
    const mod = await Test.createTestingModule({
      imports: [OrderbookModule],
    }).compile();
    const service = mod.get(OrderbookService);
    const http = (service as unknown as { http: HttpService }).http;
    expect(BOOK_TIMEOUT_MS).toBe(10_000);
    expect(http.axiosRef.defaults.timeout).toBe(BOOK_TIMEOUT_MS);
  });
});
