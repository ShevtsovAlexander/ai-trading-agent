/**
 * OI 1Г и «Всё» в сервисе (TASK-0017.3): ответ — эталон Python на фикстуре
 * (scripts/oi-long-oracle.py), кэш, пауза, отказы — на честном фейке HTTP
 * (Coinalyze режет ряд по from/to, Binance — страницы по startTime/endTime/limit).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  BadGatewayException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { DerivativesService } from './derivatives.service';
import { Exchange, OiPoint } from './derivatives.types';
import { OI_LONG_FROM } from './oi-long';

type Row = [
  number,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
];
type RawRow = { symbol: string; history: { t: number }[] };
const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'oi-long-2026-11-09.json'), 'utf8'),
) as {
  takenAt: number;
  responses: Record<string, { coinalyze: RawRow[]; klines: number[][] }>;
  expected: Record<
    string,
    { all: Row[]; '1y': Row[]; without: Record<Exchange, Row[]> }
  >;
};
const DAY = 86_400_000;
const MIN = 60_000;
const NOW = FX.takenAt;
const KEY = 'секрет-ключ-для-теста';
const EXCHANGES: Exchange[] = ['binance', 'okx', 'bybit'];
const SPOT: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
};

const toPoint = ([t, total, b, o, y, price]: Row): OiPoint => {
  const byExchange: Partial<Record<Exchange, number>> = {};
  [b, o, y].forEach((v, i) => {
    if (v !== null) byExchange[EXCHANGES[i]] = v;
  });
  return { t, totalUsd: total, byExchange, price };
};

const axiosError = (status: number, headers: Record<string, string> = {}) =>
  new AxiosError(
    `Request failed with status code ${status}`,
    undefined,
    { headers: new AxiosHeaders({ api_key: KEY }) } as never,
    undefined,
    {
      status,
      statusText: '',
      data: {},
      headers,
      config: { headers: new AxiosHeaders() },
    },
  );

type Params = Record<string, string | number>;
const fake = () => {
  const calls = { coinalyze: [] as Params[], spot: [] as Params[] };
  const state = {
    coinalyzeError: null as Error | null,
    spotDown: false,
    // Правка ответа Coinalyze перед отдачей: выпавший символ, пустой ряд
    edit: (rows: RawRow[]) => rows,
  };
  const http = {
    get: (url: string, opts: { params: Params; headers?: Params }) => {
      const p = opts.params;
      if (url === 'https://api.coinalyze.net/v1/open-interest-history') {
        calls.coinalyze.push({ ...p, api_key: opts.headers?.api_key ?? '' });
        if (state.coinalyzeError) return throwError(() => state.coinalyzeError);
        const symbols = String(p.symbols).split(',');
        const coin = Object.keys(FX.responses).find((c) =>
          FX.responses[c].coinalyze.some((r) => r.symbol === symbols[0]),
        )!;
        const rows = FX.responses[coin].coinalyze
          .filter((r) => symbols.includes(r.symbol))
          .map((r) => ({
            ...r,
            history: r.history.filter(
              (h) => h.t >= Number(p.from) && h.t <= Number(p.to),
            ),
          }));
        return of({ data: state.edit(rows), headers: {} });
      }
      if (url === 'https://api.binance.com/api/v3/klines') {
        calls.spot.push(p);
        if (state.spotDown)
          return throwError(() => new Error('spot: ECONNREFUSED'));
        const klines = FX.responses[SPOT[String(p.symbol)]].klines
          .filter(
            (k) => k[0] >= Number(p.startTime) && k[0] <= Number(p.endTime),
          )
          .slice(0, Number(p.limit));
        return of({ data: klines, headers: {} });
      }
      throw new Error(`неожиданный запрос ${url}`);
    },
  };
  return { http: http as unknown as HttpService, calls, state };
};

// Ключ явным полем: `undefined` в параметре по умолчанию подставил бы KEY
const make = ({ key }: { key: string | undefined } = { key: KEY }) => {
  const { http, calls, state } = fake();
  const config = { get: () => key } as unknown as ConfigService;
  const service = new DerivativesService(http, config);
  let now = NOW;
  service.clock = () => now;
  return { service, calls, state, setNow: (t: number) => (now = t) };
};

describe('DerivativesService: OI 1Г и «Всё»', () => {
  jest.setTimeout(20_000);

  it.each([
    ['bitcoin', 'BTC/USDT'],
    ['ethereum', 'ETH/USDT'],
    ['solana', 'SOL/USDT'],
  ])('%s: оба периода = эталону, форма по контракту', async (coin, market) => {
    const { service, calls } = make();
    for (const period of ['all', '1y'] as const) {
      const h = await service.openInterestHistory(coin, undefined, period);
      expect(h).toEqual({
        coinId: coin,
        market,
        period,
        step: '1d',
        source: 'coinalyze',
        longAvailable: true,
        exchanges: EXCHANGES.map((exchange) => ({ exchange })),
        priceError: null,
        points: FX.expected[coin][period].map(toPoint),
      });
    }
    // Оба периода — один запрос Coinalyze и одна выгрузка спота (2 страницы)
    expect(calls.coinalyze).toHaveLength(1);
    expect(calls.spot).toHaveLength(2);
  });

  it('запрос: символы монеты, from 2022-09-30, to = now, daily, USD, ключ заголовком', async () => {
    const { service, calls } = make();
    await service.openInterestHistory('ethereum', '1d', 'all');
    expect(calls.coinalyze[0]).toEqual({
      symbols: 'ETHUSDT_PERP.A,ETHUSDT_PERP.3,ETHUSDT.6',
      interval: 'daily',
      from: OI_LONG_FROM / 1000,
      to: Math.floor(NOW / 1000),
      convert_to_usd: 'true',
      api_key: KEY,
    });
    expect(calls.spot[0]).toMatchObject({
      symbol: 'ETHUSDT',
      interval: '1d',
      startTime: OI_LONG_FROM,
    });
  });

  it.each([
    ['bitcoin', '1h', '1y', /Почасовой шаг — только 30 дней/],
    ['bitcoin', '4h', 'all', /Неизвестный шаг/],
    ['bitcoin', '1d', '3m', /Неизвестный период: 3m/],
    ['dogecoin', undefined, '1y', /монета/],
  ])(
    '%s, шаг %s, период %s → 400 без запросов',
    async (coin, step, period, msg) => {
      const { service, calls } = make();
      const call = service.openInterestHistory(coin, step, period);
      await expect(call).rejects.toBeInstanceOf(BadRequestException);
      await expect(call).rejects.toThrow(msg);
      expect(calls.coinalyze.length + calls.spot.length).toBe(0);
    },
  );

  it('нет ключа (пусто или пробелы) → 502 с причиной, без запросов', async () => {
    for (const key of [undefined, '', '   ']) {
      const { service, calls } = make({ key });
      const call = service.openInterestHistory('bitcoin', undefined, '1y');
      await expect(call).rejects.toBeInstanceOf(BadGatewayException);
      await expect(call).rejects.toThrow(
        'Не задан ключ Coinalyze (COINALYZE_API_KEY в backend/.env)',
      );
      expect(calls.coinalyze.length + calls.spot.length).toBe(0);
    }
  });

  it.each(EXCHANGES)(
    'символа %s нет в ответе — ошибка в её поле, ряд = эталону без неё',
    async (down) => {
      const { service, state } = make();
      const symbol = {
        binance: 'SOLUSDT_PERP.A',
        okx: 'SOLUSDT_PERP.3',
        bybit: 'SOLUSDT.6',
      }[down];
      state.edit = (rows) => rows.filter((r) => r.symbol !== symbol);
      const h = await service.openInterestHistory('solana', undefined, 'all');
      expect(h.exchanges).toEqual(
        EXCHANGES.map((exchange) =>
          exchange === down
            ? { exchange, error: 'нет данных Coinalyze' }
            : { exchange },
        ),
      );
      expect(h.points).toEqual(FX.expected.solana.without[down].map(toPoint));
    },
  );

  it.each([
    ['пустой ряд', () => []],
    ['одни нули', (h: { t: number }[]) => h.map((p) => ({ ...p, c: 0 }))],
    ['только живой день', (h: { t: number }[]) => h.slice(-1)],
  ])(
    'у OKX %s — она недоступна, а не обнуляет весь график (критик 17.2)',
    async (_, cut) => {
      const { service, state } = make();
      state.edit = (rows) =>
        rows.map((r) =>
          r.symbol === 'BTCUSDT_PERP.3' ? { ...r, history: cut(r.history) } : r,
        );
      const h = await service.openInterestHistory('bitcoin', undefined, 'all');
      expect(h.exchanges[1]).toEqual({
        exchange: 'okx',
        error: 'нет данных Coinalyze',
      });
      expect(h.points).toEqual(FX.expected.bitcoin.without.okx.map(toPoint));
      // Биржи без ошибки — ровно те, что в byExchange (легенда фронта)
      expect(Object.keys(h.points[0].byExchange).sort()).toEqual([
        'binance',
        'bybit',
      ]);
    },
  );

  it('все символы пусты → 502 «Coinalyze недоступен»', async () => {
    const { service, state } = make();
    state.edit = () => [];
    await expect(
      service.openInterestHistory('bitcoin', undefined, '1y'),
    ).rejects.toThrow('Coinalyze недоступен');
  });

  it.each([
    [401, 'Coinalyze отклонил ключ'],
    [403, 'Coinalyze отклонил ключ'],
    [500, 'Coinalyze недоступен'],
  ])('HTTP %i → 502 «%s», ключа нет в журнале', async (status, text) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, state } = make();
    state.coinalyzeError = axiosError(status);
    const call = service.openInterestHistory('bitcoin', undefined, 'all');
    await expect(call).rejects.toBeInstanceOf(BadGatewayException);
    await expect(call).rejects.toThrow(text);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('сеть упала → 502 «Coinalyze недоступен», повтор через 60 с', async () => {
    const { service, state, calls, setNow } = make();
    state.coinalyzeError = new Error('ECONNRESET');
    await expect(
      service.openInterestHistory('bitcoin', undefined, 'all'),
    ).rejects.toThrow('Coinalyze недоступен');
    state.coinalyzeError = null;
    setNow(NOW + MIN - 1);
    await expect(
      service.openInterestHistory('bitcoin', undefined, 'all'),
    ).rejects.toThrow('Coinalyze недоступен');
    expect(calls.coinalyze).toHaveLength(1);
    setNow(NOW + MIN);
    const h = await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(h.points).toHaveLength(1501);
    expect(calls.coinalyze).toHaveLength(2);
  });

  it('429 с Retry-After → пауза всем монетам до её конца, без запросов', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, state, calls, setNow } = make();
    state.coinalyzeError = axiosError(429, { 'retry-after': '120.5' });
    await expect(
      service.openInterestHistory('bitcoin', undefined, '1y'),
    ).rejects.toThrow('Coinalyze: превышен лимит запросов');
    state.coinalyzeError = null;
    setNow(NOW + 120_499);
    await expect(
      service.openInterestHistory('ethereum', undefined, '1y'),
    ).rejects.toThrow('Coinalyze: превышен лимит запросов');
    expect(calls.coinalyze).toHaveLength(1);
    setNow(NOW + 120_500);
    await service.openInterestHistory('ethereum', undefined, '1y');
    expect(calls.coinalyze).toHaveLength(2);
  });

  it('429 без Retry-After → пауза 60 с', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, state, calls, setNow } = make();
    state.coinalyzeError = axiosError(429);
    await expect(
      service.openInterestHistory('solana', undefined, 'all'),
    ).rejects.toThrow('превышен лимит');
    state.coinalyzeError = null;
    setNow(NOW + MIN - 1);
    await expect(
      service.openInterestHistory('bitcoin', undefined, 'all'),
    ).rejects.toThrow('превышен лимит');
    setNow(NOW + MIN);
    await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(calls.coinalyze).toHaveLength(2);
  });

  it('спот упал → ряд OI цел, priceError; повтор к Binance через 60 с без запроса к Coinalyze', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, state, calls, setNow } = make();
    state.spotDown = true;
    const h = await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(h.priceError).toBe('Binance недоступен');
    expect(h.points.map((p) => p.totalUsd)).toEqual(
      FX.expected.bitcoin.all.map((r) => r[1]),
    );
    expect(h.points.every((p) => p.price === null)).toBe(true);
    state.spotDown = false;
    setNow(NOW + MIN);
    const again = await service.openInterestHistory(
      'bitcoin',
      undefined,
      'all',
    );
    expect(again.priceError).toBeNull();
    expect(again.points).toEqual(FX.expected.bitcoin.all.map(toPoint));
    expect(calls.coinalyze).toHaveLength(1);
  });

  it('полный ряд — в кэше до следующей полуночи UTC + 10 мин (±1 мс)', async () => {
    const { service, calls, setNow } = make();
    await service.openInterestHistory('bitcoin', undefined, 'all');
    const edge = Math.floor(NOW / DAY) * DAY + DAY + 10 * MIN;
    setNow(edge - 1);
    await service.openInterestHistory('bitcoin', undefined, '1y');
    expect(calls.coinalyze).toHaveLength(1);
    expect(calls.spot).toHaveLength(2);
    setNow(edge);
    await service.openInterestHistory('bitcoin', undefined, '1y');
    expect(calls.coinalyze).toHaveLength(2);
  });

  it('ряд без одной биржи — неполный, повтор через 60 с', async () => {
    const { service, state, calls, setNow } = make();
    state.edit = (rows) => rows.filter((r) => r.symbol !== 'BTCUSDT.6');
    await service.openInterestHistory('bitcoin', undefined, 'all');
    setNow(NOW + MIN - 1);
    await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(calls.coinalyze).toHaveLength(1);
    setNow(NOW + MIN);
    await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(calls.coinalyze).toHaveLength(2);
  });

  it('вчерашнего бара ещё нет (00:05 UTC) — неполный, повтор через 60 с', async () => {
    const { service, state, calls, setNow } = make();
    // Ряд заканчивается позавчера: Coinalyze ещё не отдал вчерашний день
    const today = Math.floor(NOW / DAY) * DAY;
    state.edit = (rows) =>
      rows.map((r) => ({
        ...r,
        history: r.history.filter((h) => h.t * 1000 < today - DAY),
      }));
    await service.openInterestHistory('bitcoin', undefined, 'all');
    setNow(NOW + MIN);
    await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(calls.coinalyze).toHaveLength(2);
  });

  it('дыра в середине ряда (сбойный 0) — неполный, повтор через 60 с (критик 17.3)', async () => {
    const { service, state, calls, setNow } = make();
    state.edit = (rows) =>
      rows.map((r) =>
        r.symbol === 'BTCUSDT_PERP.A'
          ? {
              ...r,
              history: r.history.map((h, i) =>
                i === 700 ? { ...h, c: 0 } : h,
              ),
            }
          : r,
      );
    const h = await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(h.points).toHaveLength(1500);
    setNow(NOW + MIN);
    await service.openInterestHistory('bitcoin', undefined, 'all');
    expect(calls.coinalyze).toHaveLength(2);
  });

  it('параллельные вызовы 1Г и «Всё» — один запрос к Coinalyze', async () => {
    const { service, calls } = make();
    await Promise.all([
      service.openInterestHistory('bitcoin', undefined, '1y'),
      service.openInterestHistory('bitcoin', undefined, 'all'),
      service.openInterestHistory('bitcoin', '1d', 'all'),
    ]);
    expect(calls.coinalyze).toHaveLength(1);
  });

  it('кэш по монете: другая монета — свой запрос', async () => {
    const { service, calls } = make();
    await service.openInterestHistory('bitcoin', undefined, 'all');
    await service.openInterestHistory('solana', undefined, 'all');
    expect(calls.coinalyze.map((c) => String(c.symbols).slice(0, 3))).toEqual([
      'BTC',
      'SOL',
    ]);
  });
});
