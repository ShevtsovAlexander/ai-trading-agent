/**
 * Ликвидации (TASK-0015): разбор и ряд — реальные ответы Coinalyze (фикстура
 * снята параметрами кода) против эталона Python, посчитанного вне проекта;
 * сервис — кэш, лимит, отказы на честном фейке HTTP.
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
import { LiquidationsService } from './liquidations.service';
import {
  LIQ_CLOSE_MARGIN_MS,
  LIQ_ERROR_TTL_MS,
  LIQ_PERIODS,
  LIQUIDATION_SYMBOLS,
  LiqPeriod,
} from './liquidations.types';
import { buildLiqSeries, sumLast24h } from './series';
import { LiqBar, fetchLiquidations, parseLiquidations } from './sources';

type RawRow = {
  symbol: string;
  history: { t: number; l: number; s: number }[];
};
const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'history-2026-11-05.json'), 'utf8'),
) as {
  takenAt: number;
  responses: Record<string, Record<LiqPeriod, RawRow[]>>;
  expected: Record<
    string,
    Record<LiqPeriod, [number, number | null, number | null][]> & {
      last24h: {
        longUsd: number;
        shortUsd: number;
        from: number;
        to: number;
      };
    }
  >;
};
const COIN_IDS = ['bitcoin', 'ethereum', 'solana'];
const PERIODS: LiqPeriod[] = ['1d', '1m', '1y'];
const KEY = 'секрет-ключ-для-теста';
const close = (a: number, b: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(
    Math.max(Math.abs(b) * 1e-9, 1e-6),
  );

const symbolsOf = (coin: string) => Object.values(LIQUIDATION_SYMBOLS[coin]);

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

describe('parseLiquidations', () => {
  it('реальный ответ: секунды → мс, все точки на месте', () => {
    for (const coin of COIN_IDS) {
      for (const period of PERIODS) {
        const raw = FX.responses[coin][period];
        const parsed = parseLiquidations(raw, symbolsOf(coin));
        for (const row of raw) {
          expect(parsed.get(row.symbol)).toEqual(
            row.history.map((p) => ({ t: p.t * 1000, long: p.l, short: p.s })),
          );
        }
      }
    }
  });

  const ok = { symbol: 'A', history: [{ t: 60, l: 1, s: 2 }] };
  it('символа нет в ответе — отказ одной биржи, а не ошибка', () => {
    const parsed = parseLiquidations([ok], ['A', 'B']);
    expect(parsed.has('B')).toBe(false);
  });

  it.each([
    ['не массив', { a: 1 }, /не массив/],
    ['чужой символ', [{ symbol: 'X', history: [] }], /чужой символ/],
    ['без history', [{ symbol: 'A' }], /без history/],
    [
      'строка вместо числа',
      [{ ...ok, history: [{ t: 60, l: '1', s: 2 }] }],
      /поле l/,
    ],
    ['минус', [{ ...ok, history: [{ t: 60, l: 1, s: -2 }] }], /поле s/],
    ['NaN', [{ ...ok, history: [{ t: 60, l: NaN, s: 2 }] }], /поле l/],
    ['нет суммы', [{ ...ok, history: [{ t: 60, s: 2 }] }], /поле l/],
    ['дробное время', [{ ...ok, history: [{ t: 1.5, l: 1, s: 2 }] }], /поле t/],
    [
      'время строкой',
      [{ ...ok, history: [{ t: '60', l: 1, s: 2 }] }],
      /поле t/,
    ],
  ])('%s — ошибка с именем источника', (_name, raw, re) => {
    expect(() => parseLiquidations(raw, ['A', 'B'])).toThrow(/Coinalyze/);
    expect(() => parseLiquidations(raw, ['A', 'B'])).toThrow(re);
  });
});

describe('fetchLiquidations', () => {
  it('ключ — в заголовке, не в адресе; время — в секундах', async () => {
    const get = jest.fn(() => of({ data: [] }));
    await fetchLiquidations(
      { get } as unknown as HttpService,
      KEY,
      ['A', 'B'],
      '15min',
      900_000,
      1_800_000,
    );
    const [url, cfg] = get.mock.calls[0] as unknown as [
      string,
      { headers: object; params: Record<string, unknown> },
    ];
    expect(url).not.toContain(KEY);
    expect(JSON.stringify(cfg.params)).not.toContain(KEY);
    expect(cfg.headers).toEqual({ api_key: KEY });
    expect(cfg.params).toEqual({
      symbols: 'A,B',
      interval: '15min',
      from: 900,
      to: 1800,
      convert_to_usd: 'true',
    });
  });
});

describe('buildLiqSeries — против эталона Python', () => {
  for (const coin of COIN_IDS) {
    for (const period of PERIODS) {
      it(`${coin} ${period}: каждая точка совпала`, () => {
        const { stepMs, bars } = LIQ_PERIODS[period];
        const expected = FX.expected[coin][period];
        const parsed = parseLiquidations(
          FX.responses[coin][period],
          symbolsOf(coin),
        );
        const points = buildLiqSeries(expected[0][0], stepMs, bars, [
          ...parsed.values(),
        ]);
        expect(points).toHaveLength(bars);
        points.forEach((p, i) => {
          const [t, long, short] = expected[i];
          expect(p.t).toBe(t);
          if (long === null || short === null) {
            expect(p.longUsd).toBeNull();
            expect(p.shortUsd).toBeNull();
          } else {
            close(p.longUsd!, long);
            close(p.shortUsd!, short);
          }
        });
      });
    }
    it(`${coin}: сумма за 24 часа совпала`, () => {
      const { stepMs, bars } = LIQ_PERIODS['1d'];
      const e = FX.expected[coin];
      const parsed = parseLiquidations(
        FX.responses[coin]['1d'],
        symbolsOf(coin),
      );
      const sum = sumLast24h(
        buildLiqSeries(e['1d'][0][0], stepMs, bars, [...parsed.values()]),
        stepMs,
      );
      close(sum.longUsd, e.last24h.longUsd);
      close(sum.shortUsd, e.last24h.shortUsd);
      expect(sum.from).toBe(e.last24h.from);
      expect(sum.to).toBe(e.last24h.to);
    });
  }

  const bar = (t: number, long = 1, short = 2): LiqBar => ({ t, long, short });
  it('запись только у одной биржи — сумма по ней; нигде нет — null, не 0', () => {
    const points = buildLiqSeries(0, 10, 3, [
      [bar(0)],
      [bar(0, 5, 0), bar(20)],
    ]);
    expect(points).toEqual([
      { t: 0, longUsd: 6, shortUsd: 2 },
      { t: 10, longUsd: null, shortUsd: null },
      { t: 20, longUsd: 1, shortUsd: 2 },
    ]);
  });

  it('ноль от биржи остаётся нулём, не null', () => {
    expect(buildLiqSeries(0, 10, 1, [[bar(0, 0, 0)]])[0]).toEqual({
      t: 0,
      longUsd: 0,
      shortUsd: 0,
    });
  });

  it('метка не на сетке и дубль биржи — ошибка; вне окна — отброшена', () => {
    expect(() => buildLiqSeries(0, 10, 3, [[bar(5)]])).toThrow(/не на сетке/);
    expect(() => buildLiqSeries(0, 10, 3, [[bar(0), bar(0)]])).toThrow(/дубль/);
    const pts = buildLiqSeries(10, 10, 2, [[bar(0), bar(30), bar(10)]]);
    expect(pts.map((p) => p.longUsd)).toEqual([1, null]);
  });
});

describe('LiquidationsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  const INTERVAL_TO_PERIOD: Record<string, LiqPeriod> = {
    '15min': '1d',
    '1hour': '1m',
    daily: '1y',
  };
  const fixtureGet = jest.fn(
    (_url: string, cfg: { params: Record<string, string> }) => {
      const coin = COIN_IDS.find((c) =>
        cfg.params.symbols.startsWith(LIQUIDATION_SYMBOLS[c].binance),
      )!;
      return of({
        data: FX.responses[coin][INTERVAL_TO_PERIOD[cfg.params.interval]],
      });
    },
  );

  const make = (get: unknown, key: string | undefined = KEY) => {
    const svc = new LiquidationsService(
      { get } as unknown as HttpService,
      { get: () => key } as unknown as ConfigService,
    );
    let now = FX.takenAt;
    svc.clock = () => now;
    return { svc, advance: (ms: number) => (now += ms) };
  };

  beforeEach(() => fixtureGet.mockClear());

  it('окно запроса — ровно закрытые свечи; ответ = эталону на 3 монетах × 3 периодах', async () => {
    const { svc } = make(fixtureGet);
    for (const coin of COIN_IDS) {
      for (const period of PERIODS) {
        const r = await svc.get(coin, period);
        const e = FX.expected[coin][period];
        expect(r.points.map((p) => p.t)).toEqual(e.map((x) => x[0]));
        close(r.last24h.longUsd, FX.expected[coin].last24h.longUsd);
        expect(r.exchanges).toEqual([
          { exchange: 'binance' },
          { exchange: 'okx' },
          { exchange: 'bybit' },
        ]);
      }
    }
    const params = fixtureGet.mock.calls.map((c) => c[1].params);
    expect(params.filter((p) => p.interval === 'daily')[0].to).toBe(
      FX.expected.bitcoin['1y'][364][0] / 1000,
    );
  });

  it('незакрытая свеча не запрашивается: окно кончается на последней закрытой', async () => {
    const step = LIQ_PERIODS['1d'].stepMs;
    const boundary = FX.takenAt - (FX.takenAt % step) + step;
    const lastAt = async (now: number) => {
      const { svc } = make(fixtureGet);
      svc.clock = () => now;
      const r = await svc.get('bitcoin', '1d');
      return r.points[r.points.length - 1].t;
    };
    // Свеча, закрытая в boundary, входит только через минуту после закрытия
    expect(await lastAt(boundary + LIQ_CLOSE_MARGIN_MS - 1)).toBe(
      boundary - 2 * step,
    );
    expect(await lastAt(boundary + LIQ_CLOSE_MARGIN_MS)).toBe(boundary - step);
  });

  it('кэш держится до закрытия следующей свечи + запас, затем новый запрос', async () => {
    const { svc, advance } = make(fixtureGet);
    await svc.get('bitcoin', '1d');
    expect(fixtureGet).toHaveBeenCalledTimes(1);
    const step = LIQ_PERIODS['1d'].stepMs;
    const end = Math.floor((FX.takenAt - LIQ_CLOSE_MARGIN_MS) / step) * step;
    advance(end + step + LIQ_CLOSE_MARGIN_MS - FX.takenAt - 1);
    await svc.get('bitcoin', '1d');
    expect(fixtureGet).toHaveBeenCalledTimes(1);
    advance(1);
    await svc.get('bitcoin', '1d');
    expect(fixtureGet).toHaveBeenCalledTimes(2);
  });

  it('1М и 1Г берут ещё и 15 минут для суммы за 24 часа; 1Д — один запрос', async () => {
    const { svc } = make(fixtureGet);
    const m = await svc.get('solana', '1m');
    expect(
      fixtureGet.mock.calls.map((c) => c[1].params.interval).sort(),
    ).toEqual(['15min', '1hour']);
    const d = await svc.get('solana', '1d');
    expect(fixtureGet).toHaveBeenCalledTimes(2);
    expect(m.last24h).toEqual(d.last24h);
  });

  it('параллельные вызовы — один запрос', async () => {
    const { svc } = make(fixtureGet);
    await Promise.all([svc.get('ethereum', '1d'), svc.get('ethereum', '1d')]);
    expect(fixtureGet).toHaveBeenCalledTimes(1);
  });

  it('неизвестная монета и период — 400 без запроса', async () => {
    const { svc } = make(fixtureGet);
    await expect(svc.get('dogecoin', '1d')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.get('constructor', '1d')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.get('bitcoin', '5y')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fixtureGet).not.toHaveBeenCalled();
  });

  it.each([[undefined], [''], ['   ']])(
    'ключ %j — 502 с текстом, без запроса',
    async (key) => {
      const svc = new LiquidationsService(
        { get: fixtureGet } as unknown as HttpService,
        { get: () => key } as unknown as ConfigService,
      );
      await expect(svc.get('bitcoin', '1d')).rejects.toThrow(
        /COINALYZE_API_KEY/,
      );
      await expect(svc.get('bitcoin', '1d')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(fixtureGet).not.toHaveBeenCalled();
    },
  );

  it.each([
    [401, /отклонил ключ/],
    [403, /отклонил ключ/],
    [500, /Coinalyze недоступен/],
  ])('отказ %i — 502 с текстом, повтор через минуту', async (status, re) => {
    const get = jest.fn(() => throwError(() => axiosError(status)));
    const { svc, advance } = make(get);
    await expect(svc.get('bitcoin', '1d')).rejects.toThrow(re);
    await expect(svc.get('bitcoin', '1d')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(get).toHaveBeenCalledTimes(1);
    advance(LIQ_ERROR_TTL_MS);
    await expect(svc.get('bitcoin', '1d')).rejects.toThrow(re);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('429 — пауза по Retry-After на все монеты, запросов нет до её конца', async () => {
    const get = jest.fn(() =>
      throwError(() => axiosError(429, { 'retry-after': '120' })),
    );
    const { svc, advance } = make(get);
    await expect(svc.get('bitcoin', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(1);
    await expect(svc.get('ethereum', '1d')).rejects.toThrow(/лимит/);
    advance(119_000);
    await expect(svc.get('solana', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(1);
    advance(1000);
    await expect(svc.get('solana', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('429 с дробным Retry-After, как отвечает Coinalyze («27.293»)', async () => {
    const get = jest.fn(() =>
      throwError(() => axiosError(429, { 'retry-after': '27.293' })),
    );
    const { svc, advance } = make(get);
    await expect(svc.get('bitcoin', '1d')).rejects.toThrow(/лимит/);
    advance(27_292);
    await expect(svc.get('ethereum', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(1);
    advance(1);
    await expect(svc.get('ethereum', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('429 без Retry-After — пауза 60 с', async () => {
    const get = jest.fn(() => throwError(() => axiosError(429)));
    const { svc, advance } = make(get);
    await expect(svc.get('bitcoin', '1d')).rejects.toThrow(/лимит/);
    advance(59_000);
    await expect(svc.get('ethereum', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(1);
    advance(1000);
    await expect(svc.get('ethereum', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('порча данных — 502 «недоступен», а не 500', async () => {
    const get = jest.fn(() => of({ data: { oops: 1 } }));
    const { svc } = make(get);
    await expect(svc.get('bitcoin', '1d')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(svc.get('bitcoin', '1d')).rejects.toThrow(
      /Coinalyze недоступен/,
    );
  });

  it('1Г без записи за последний день у биржи — повтор через минуту, не через сутки', async () => {
    const raw = FX.responses.bitcoin['1y'];
    const day = FX.responses.bitcoin['1d'];
    const lastT = FX.expected.bitcoin['1y'][364][0] / 1000;
    const cut = raw.map((r, i) =>
      i === 0 ? { ...r, history: r.history.filter((p) => p.t !== lastT) } : r,
    );
    let full = false;
    const get = jest.fn((_u: string, c: { params: Record<string, string> }) =>
      of({
        data: c.params.interval === '15min' ? day : full ? raw : cut,
      }),
    );
    const { svc, advance } = make(get);
    const dailyCalls = () =>
      get.mock.calls.filter((x) => x[1].params.interval === 'daily').length;
    await svc.get('bitcoin', '1y');
    advance(LIQ_ERROR_TTL_MS - 1);
    await svc.get('bitcoin', '1y');
    expect(dailyCalls()).toBe(1);
    full = true;
    advance(1);
    await svc.get('bitcoin', '1y');
    expect(dailyCalls()).toBe(2);
    // Дописанный день держится до следующего закрытия
    advance(LIQ_ERROR_TTL_MS);
    await svc.get('bitcoin', '1y');
    expect(dailyCalls()).toBe(2);
  });

  it('1Д без записи за последнюю свечу — кэш до следующего закрытия: пустая свеча тут норма', async () => {
    const lastT = FX.expected.bitcoin['1d'][95][0] / 1000;
    const get = jest.fn(() =>
      of({
        data: FX.responses.bitcoin['1d'].map((r) => ({
          ...r,
          history: r.history.filter((p) => p.t !== lastT),
        })),
      }),
    );
    const { svc, advance } = make(get);
    await svc.get('bitcoin', '1d');
    advance(LIQ_ERROR_TTL_MS);
    await svc.get('bitcoin', '1d');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('второй 429 с меньшей паузой не сокращает первую', async () => {
    const answers = [
      axiosError(429, { 'retry-after': '120' }),
      axiosError(429, { 'retry-after': '1' }),
    ];
    let n = 0;
    const get = jest.fn(() => throwError(() => answers[n++]));
    const { svc, advance } = make(get);
    const pending = [svc.get('bitcoin', '1d'), svc.get('ethereum', '1d')];
    await Promise.all(pending.map((x) => x.catch(() => undefined)));
    expect(get).toHaveBeenCalledTimes(2);
    advance(100_000);
    await expect(svc.get('solana', '1d')).rejects.toThrow(/лимит/);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('биржи нет или ряд пуст — её поле, сумма без неё, повтор через минуту', async () => {
    const raw = FX.responses.bitcoin['1d'];
    const okx = LIQUIDATION_SYMBOLS.bitcoin.okx;
    const bybit = LIQUIDATION_SYMBOLS.bitcoin.bybit;
    const get = jest.fn(() =>
      of({
        data: raw
          .filter((r) => r.symbol !== okx)
          .map((r) => (r.symbol === bybit ? { ...r, history: [] } : r)),
      }),
    );
    const { svc, advance } = make(get);
    const r = await svc.get('bitcoin', '1d');
    expect(r.exchanges).toEqual([
      { exchange: 'binance' },
      { exchange: 'okx', error: 'нет данных Coinalyze' },
      { exchange: 'bybit', error: 'нет данных Coinalyze' },
    ]);
    const binance = raw.find(
      (x) => x.symbol === LIQUIDATION_SYMBOLS.bitcoin.binance,
    )!;
    close(
      r.last24h.longUsd,
      binance.history.reduce((a, p) => a + p.l, 0),
    );
    advance(LIQ_ERROR_TTL_MS - 1);
    await svc.get('bitcoin', '1d');
    expect(get).toHaveBeenCalledTimes(1);
    advance(1);
    await svc.get('bitcoin', '1d');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('все биржи пусты — 502', async () => {
    const get = jest.fn(() => of({ data: [] }));
    const { svc } = make(get);
    await expect(svc.get('bitcoin', '1d')).rejects.toThrow(
      /Coinalyze недоступен/,
    );
  });

  it('отказ ряда 15 минут роняет и 1Г: сумма за 24 часа иначе соврала бы', async () => {
    const get = jest.fn((_u: string, c: { params: Record<string, string> }) =>
      c.params.interval === '15min'
        ? throwError(() => axiosError(500))
        : of({ data: FX.responses.bitcoin['1y'] }),
    );
    const { svc } = make(get);
    await expect(svc.get('bitcoin', '1y')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('значение ключа не попадает в журнал и текст ошибки', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    warn.mockClear();
    const get = jest.fn(() => throwError(() => axiosError(403)));
    const { svc } = make(get);
    const err = await svc.get('bitcoin', '1d').catch((e: Error) => e);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    expect(String((err as Error).message)).not.toContain(KEY);
  });
});
