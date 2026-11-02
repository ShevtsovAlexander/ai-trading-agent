import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { fetchBookOkx, fetchDepthBinance } from './sources';

// Реальные ответы спота двух бирж (curl 2026-11-02, параллельно) — оракул
// разбора: уровни сверяются с полями ответа, а не с тем, что выдаёт код.
type Raw = Record<string, any>;
interface Fixture {
  binance: Record<string, Raw>;
  okx: Record<string, Raw>;
  errors: { binance: Raw; okx: Raw };
}
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return --
   поля фикстуры — сырой JSON бирж, форма проверяется самим тестом */
const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'books-2026-11-02.json'), 'utf8'),
) as Fixture;

// Фейк отдаёт заданное тело на любой URL и запоминает запросы
const replying = (data: unknown) => {
  const calls: { url: string; params: Record<string, unknown> }[] = [];
  const http = {
    get: (url: string, { params }: { params: Record<string, unknown> }) => {
      calls.push({ url, params });
      return of({ data, headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls };
};

// Уровень ответа [цена, объём, …] строками → [число, число]
const levels = (rows: unknown) =>
  (rows as string[][]).map((r) => [Number(r[0]), Number(r[1])]);

const clone = (raw: Raw): Raw => JSON.parse(JSON.stringify(raw));

const NOW = 1_793_617_447_000;
const CLOCK = () => NOW;
const BINANCE = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const OKX = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];

describe('fetchDepthBinance', () => {
  it.each(BINANCE)(
    '%s: уровни как в ответе, время — часы бэкенда',
    async (symbol) => {
      const raw = FX.binance[symbol];
      const { http, calls } = replying(raw);
      const book = await fetchDepthBinance(http, symbol, CLOCK);
      expect(book.bids).toEqual(levels(raw.bids));
      expect(book.asks).toEqual(levels(raw.asks));
      expect(book.at).toBe(NOW);
      expect(calls).toEqual([
        {
          url: 'https://api.binance.com/api/v3/depth',
          params: { symbol, limit: 5000 },
        },
      ]);
    },
  );

  it('время — часы после ответа, не до запроса (критик T1)', async () => {
    const order: string[] = [];
    const http = {
      get: () => {
        order.push('запрос');
        return of({ data: FX.binance.BTCUSDT, headers: {} });
      },
    } as unknown as HttpService;
    const clock = () => {
      order.push('часы');
      return NOW;
    };
    await fetchDepthBinance(http, 'BTCUSDT', clock);
    expect(order).toEqual(['запрос', 'часы']);
  });

  it('пустое тело — ошибка, не пустой стакан', async () => {
    await expect(
      fetchDepthBinance(replying('').http, 'BTCUSDT', CLOCK),
    ).rejects.toThrow(/Binance depth BTCUSDT: bids не массив/);
  });

  it('BTC и ETH — 5000 уровней на сторону, не целиком', async () => {
    for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
      const book = await fetchDepthBinance(
        replying(FX.binance[symbol]).http,
        symbol,
        CLOCK,
      );
      expect([book.bids.length, book.asks.length]).toEqual([5000, 5000]);
      expect(book.full).toEqual({ bid: false, ask: false });
    }
  });

  it('SOL — покупки короче 5000: сторона отдана целиком', async () => {
    const raw = FX.binance.SOLUSDT;
    const book = await fetchDepthBinance(replying(raw).http, 'SOLUSDT', CLOCK);
    expect(raw.bids.length).toBeLessThan(5000);
    expect(book.bids.length).toBe(raw.bids.length);
    expect(book.full).toEqual({ bid: true, ask: false });
  });

  it('HTTP 400 на неизвестный символ — ошибка не глотается', async () => {
    const http = {
      get: () =>
        throwError(() =>
          Object.assign(new Error('Request failed with status code 400'), {
            response: FX.errors.binance,
          }),
        ),
    } as unknown as HttpService;
    await expect(fetchDepthBinance(http, 'FOOUSDT', CLOCK)).rejects.toThrow(
      /400/,
    );
  });
});

describe('fetchBookOkx', () => {
  it.each(OKX)('%s: уровни как в ответе, время — ts ответа', async (instId) => {
    const raw = FX.okx[instId];
    const row = raw.data[0];
    const { http, calls } = replying(raw);
    const book = await fetchBookOkx(http, instId);
    expect(book.bids).toEqual(levels(row.bids));
    expect(book.asks).toEqual(levels(row.asks));
    expect(book.at).toBe(Number(row.ts));
    expect(book.full).toEqual({ bid: false, ask: false });
    expect(calls).toEqual([
      {
        url: 'https://www.okx.com/api/v5/market/books-full',
        params: { instId, sz: 5000 },
      },
    ]);
  });

  it('code ≠ "0" при HTTP 200 — ошибка с кодом', async () => {
    await expect(
      fetchBookOkx(replying(FX.errors.okx).http, 'FOO-USDT'),
    ).rejects.toThrow(/OKX books-full FOO-USDT: код 51001/);
  });

  it('нет ts — ошибка', async () => {
    const raw = clone(FX.okx['BTC-USDT']);
    delete raw.data[0].ts;
    await expect(fetchBookOkx(replying(raw).http, 'BTC-USDT')).rejects.toThrow(
      /ts/,
    );
  });

  it('пустой data — ошибка', async () => {
    await expect(
      fetchBookOkx(replying({ code: '0', msg: '', data: [] }).http, 'BTC-USDT'),
    ).rejects.toThrow(/нет данных/);
  });
});

// Порча одного уровня реального ответа → ошибка с именем биржи, а не NaN,
// 0 или молча принятый стакан
type Spoil = (rows: string[][]) => void;
const spoils: [string, 'bids' | 'asks', Spoil, RegExp][] = [
  [
    'пустая строка цены',
    'bids',
    (r) => (r[3][0] = ''),
    /поле bids\[3\] цена не число/,
  ],
  [
    'пробельный объём',
    'asks',
    (r) => (r[7][1] = '  '),
    /поле asks\[7\] объём не число/,
  ],
  [
    'отрицательный объём',
    'bids',
    (r) => (r[0][1] = '-1'),
    /поле bids\[0\] объём вне диапазона/,
  ],
  [
    'цена 0',
    'asks',
    (r) => (r[0][0] = '0'),
    /поле asks\[0\] цена вне диапазона/,
  ],
  [
    'покупки не по убыванию',
    'bids',
    (r) => ([r[10], r[11]] = [r[11], r[10]]),
    /bids\[11\] нарушен порядок/,
  ],
  [
    'продажи не по возрастанию',
    'asks',
    (r) => ([r[20], r[21]] = [r[21], r[20]]),
    /asks\[21\] нарушен порядок/,
  ],
  [
    'дубль цены',
    'asks',
    (r) => (r[5] = [...r[4]]),
    /asks\[5\] нарушен порядок/,
  ],
  [
    'уровень не массив',
    'bids',
    (r) => ((r as unknown[])[2] = '1'),
    /bids\[2\] не уровень/,
  ],
];

describe.each(spoils)('строгий разбор: %s', (_, name, spoil, error) => {
  it('Binance', async () => {
    const raw = clone(FX.binance.BTCUSDT);
    spoil(raw[name] as string[][]);
    await expect(
      fetchDepthBinance(replying(raw).http, 'BTCUSDT', CLOCK),
    ).rejects.toThrow(new RegExp(`Binance depth BTCUSDT: ${error.source}`));
  });

  it('OKX', async () => {
    const raw = clone(FX.okx['BTC-USDT']);
    spoil(raw.data[0][name] as string[][]);
    await expect(fetchBookOkx(replying(raw).http, 'BTC-USDT')).rejects.toThrow(
      new RegExp(`OKX books-full BTC-USDT: ${error.source}`),
    );
  });
});

describe('пустая или отсутствующая сторона', () => {
  it.each(['bids', 'asks'])('%s = [] — ошибка', async (name) => {
    const raw = clone(FX.binance.BTCUSDT);
    raw[name] = [];
    await expect(
      fetchDepthBinance(replying(raw).http, 'BTCUSDT', CLOCK),
    ).rejects.toThrow(/пустая сторона/);
  });

  it('нет asks — ошибка', async () => {
    const raw = clone(FX.okx['ETH-USDT']);
    delete raw.data[0].asks;
    await expect(fetchBookOkx(replying(raw).http, 'ETH-USDT')).rejects.toThrow(
      /asks не массив/,
    );
  });
});
