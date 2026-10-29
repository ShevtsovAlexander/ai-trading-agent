import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { DerivativesService, SNAPSHOT_TTL_MS } from './derivatives.service';
import { FundingView, OiPoint, OiStep, SourceError } from './derivatives.types';

type Raw = Record<string, any>;
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   поля фикстуры — сырой JSON бирж */
const LIVE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'live-2026-10-27.json'), 'utf8'),
) as Record<string, Record<string, Raw>>;

const H8 = 8 * 3_600_000;
const DAY = 86_400_000;
// «Сейчас» — момент снятия фикстуры BTC: до выплаты 1793116800000 ещё ~4 ч
const NOW = LIVE.binancePremiumIndex.BTCUSDT.time as number;
const NEXT = LIVE.binancePremiumIndex.BTCUSDT.nextFundingTime as number;

type Source = 'premiumIndex' | 'fundingRate' | 'openInterest' | 'okx' | 'bybit';
const sourceOf = (url: string): Source =>
  url.includes('premiumIndex')
    ? 'premiumIndex'
    : url.includes('fundingRate')
      ? 'fundingRate'
      : url.includes('openInterest')
        ? 'openInterest'
        : url.includes('okx')
          ? 'okx'
          : 'bybit';

// История выплат: шаг 8 ч, последняя — за 8 ч до NEXT, ставка 0,005 %
// (ниже нейтральной и ниже текущей 0,008241 % — хвост «≤ текущей» = 100 %)
const historyRows = (upTo = NEXT - H8, days = 400, step = H8) =>
  Array.from({ length: (days * DAY) / step }, (_, i) => ({
    symbol: 'BTCUSDT',
    fundingTime: upTo - i * step,
    fundingRate: '0.00005000',
  })).reverse();

// Фейк по URL: реальные ответы бирж; история — с фильтром startTime/
// endTime/limit, как Binance. fail — источник отвечает ошибкой сети.
const fakeHttp = () => {
  const calls: Record<Source, Raw[]> = {
    premiumIndex: [],
    fundingRate: [],
    openInterest: [],
    okx: [],
    bybit: [],
  };
  const state = {
    fail: new Set<Source>(),
    history: historyRows(),
  };
  const http = {
    get: (url: string, { params }: { params: Raw }) => {
      const src = sourceOf(url);
      calls[src].push(params);
      if (state.fail.has(src)) {
        return throwError(() => new Error(`${src}: ECONNREFUSED`));
      }
      let data: unknown;
      if (src === 'premiumIndex')
        data = LIVE.binancePremiumIndex[params.symbol];
      else if (src === 'openInterest')
        data = LIVE.binanceOpenInterest[params.symbol];
      else if (src === 'okx') data = LIVE.okxOpenInterest[params.instId];
      else if (src === 'bybit') data = LIVE.bybitTickers[params.symbol];
      else
        data = state.history
          .filter(
            (r) =>
              r.fundingTime >= params.startTime &&
              r.fundingTime <= params.endTime,
          )
          .slice(0, params.limit as number);
      return of({ data, headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls, state };
};

const makeService = () => {
  const { http, calls, state } = fakeHttp();
  const service = new DerivativesService(http);
  let now = NOW;
  service.clock = () => now;
  const count = () =>
    Object.fromEntries(
      Object.entries(calls).map(([k, v]) => [k, v.length]),
    ) as Record<Source, number>;
  return { service, calls, state, count, advance: (ms: number) => (now += ms) };
};

// Ожидания — из полей фикстуры напрямую, не из кода
const binanceUsd =
  Number(LIVE.binanceOpenInterest.BTCUSDT.openInterest) *
  Number(LIVE.binancePremiumIndex.BTCUSDT.markPrice);
const okxUsd = Number(LIVE.okxOpenInterest['BTC-USDT-SWAP'].data[0].oiUsd);
const bybitUsd = Number(
  LIVE.bybitTickers.BTCUSDT.result.list[0].openInterestValue,
);

describe('DerivativesService.get', () => {
  it('все источники живы: форма по контракту, сумма трёх бирж', async () => {
    const { service } = makeService();
    const d = await service.get('bitcoin');

    expect(d.coinId).toBe('bitcoin');
    expect(d.market).toBe('BTC/USDT');
    const f = d.funding as FundingView;
    expect(f).toMatchObject({
      exchange: 'binance',
      rate: 0.00008241,
      nextFundingTime: NEXT,
      at: NOW,
    });
    // 365 дней по 3 выплаты, все 0,005 % ≤ 0,008241 %
    expect(f.stress).toEqual({
      state: 'below',
      tailPct: 100,
      periodDays: 365,
      samples: 1095,
      intervalHours: 8,
    });
    expect(d.openInterest.exchanges.map((e) => e.exchange)).toEqual([
      'binance',
      'okx',
      'bybit',
    ]);
    expect(d.openInterest.exchanges).toEqual([
      {
        exchange: 'binance',
        usd: binanceUsd,
        at: LIVE.binanceOpenInterest.BTCUSDT.time,
      },
      {
        exchange: 'okx',
        usd: okxUsd,
        at: Number(LIVE.okxOpenInterest['BTC-USDT-SWAP'].data[0].ts),
      },
      { exchange: 'bybit', usd: bybitUsd, at: LIVE.bybitTickers.BTCUSDT.time },
    ]);
    expect(d.openInterest.totalUsd).toBeCloseTo(
      binanceUsd + okxUsd + bybitUsd,
      2,
    );
    // порядок величины — от кода не зависит: ≈ 15,6 млрд USD (research)
    expect(d.openInterest.totalUsd).toBeGreaterThan(15.5e9);
    expect(d.openInterest.totalUsd).toBeLessThan(15.7e9);
  });

  it('ethereum — символы ETH на всех трёх биржах', async () => {
    const { service, calls } = makeService();
    const d = await service.get('ethereum');
    expect(d.market).toBe('ETH/USDT');
    expect(calls.premiumIndex[0].symbol).toBe('ETHUSDT');
    expect(calls.openInterest[0].symbol).toBe('ETHUSDT');
    expect(calls.okx[0].instId).toBe('ETH-USDT-SWAP');
    expect(calls.bybit[0].symbol).toBe('ETHUSDT');
  });

  it('упала OKX: у неё ошибка, сумма — Binance + Bybit, funding на месте', async () => {
    const { service, state } = makeService();
    state.fail.add('okx');
    const d = await service.get('bitcoin');
    expect(d.openInterest.exchanges[1]).toEqual({
      exchange: 'okx',
      error: 'OKX недоступен',
    });
    expect(d.openInterest.totalUsd).toBeCloseTo(binanceUsd + bybitUsd, 2);
    expect((d.funding as FundingView).rate).toBe(0.00008241);
  });

  it('упал premiumIndex: funding и OI Binance — ошибка, OKX + Bybit на месте', async () => {
    const { service, state, calls } = makeService();
    state.fail.add('premiumIndex');
    const d = await service.get('bitcoin');
    expect(d.funding).toEqual({ error: 'Binance недоступен' });
    expect(d.openInterest.exchanges[0]).toEqual({
      exchange: 'binance',
      error: 'Binance недоступен',
    });
    expect(d.openInterest.totalUsd).toBeCloseTo(okxUsd + bybitUsd, 2);
    // без markPrice OI Binance не запрашивался
    expect(calls.openInterest).toHaveLength(0);
  });

  it('упал только openInterest Binance: funding есть, OI Binance — ошибка', async () => {
    const { service, state } = makeService();
    state.fail.add('openInterest');
    const d = await service.get('bitcoin');
    expect((d.funding as FundingView).stress?.state).toBe('below');
    expect(d.openInterest.exchanges[0]).toEqual({
      exchange: 'binance',
      error: 'Binance недоступен',
    });
    expect(d.openInterest.totalUsd).toBeCloseTo(okxUsd + bybitUsd, 2);
  });

  it('упало всё: totalUsd null, маршрут не бросает', async () => {
    const { service, state } = makeService();
    for (const s of [
      'premiumIndex',
      'fundingRate',
      'openInterest',
      'okx',
      'bybit',
    ] as const) {
      state.fail.add(s);
    }
    const d = await service.get('bitcoin');
    expect(d.funding).toEqual({ error: 'Binance недоступен' } as SourceError);
    expect(d.openInterest.totalUsd).toBeNull();
    expect(d.openInterest.exchanges.every((e) => 'error' in e)).toBe(true);
  });

  it('история не загрузилась: stress null, ставка есть', async () => {
    const { service, state } = makeService();
    state.fail.add('fundingRate');
    const f = (await service.get('bitcoin')).funding as FundingView;
    expect(f.rate).toBe(0.00008241);
    expect(f.stress).toBeNull();
  });

  it('история запрашивается со startTime = now − 366 дн по now', async () => {
    const { service, calls } = makeService();
    await service.get('bitcoin');
    expect(calls.fundingRate[0]).toMatchObject({
      symbol: 'BTCUSDT',
      startTime: NOW - 366 * DAY,
      endTime: NOW,
    });
  });

  it('кэш: в пределах 30 с — 0 запросов; после — снимок заново, история нет', async () => {
    const { service, count, advance } = makeService();
    await service.get('bitcoin');
    const first = count();
    expect(first.premiumIndex).toBe(1);
    expect(first.fundingRate).toBeGreaterThan(0);

    advance(SNAPSHOT_TTL_MS - 1);
    await service.get('bitcoin');
    expect(count()).toEqual(first);

    advance(1);
    await service.get('bitcoin');
    const second = count();
    expect(second.premiumIndex).toBe(2);
    expect(second.okx).toBe(2);
    expect(second.bybit).toBe(2);
    expect(second.openInterest).toBe(2);
    // до nextFundingTime история та же
    expect(second.fundingRate).toBe(first.fundingRate);
  });

  it('после nextFundingTime история запрашивается заново', async () => {
    const { service, count, advance } = makeService();
    await service.get('bitcoin');
    const before = count().fundingRate;
    advance(NEXT - NOW); // ровно момент выплаты
    await service.get('bitcoin');
    expect(count().fundingRate).toBeGreaterThan(before);
  });

  it('в истории нет последней выплаты — не кэшируется, следующий снимок спросит снова', async () => {
    const { service, state, count, advance } = makeService();
    state.history = historyRows(NEXT - 2 * H8); // последняя выплата пропущена
    await service.get('bitcoin');
    const before = count().fundingRate;
    advance(SNAPSHOT_TTL_MS);
    await service.get('bitcoin');
    expect(count().fundingRate).toBeGreaterThan(before);
  });

  it('интервал 4 ч, последняя выплата пропущена — не кэшируется (критик T4)', async () => {
    const { service, state, count, advance } = makeService();
    const H4 = H8 / 2;
    // выплаты каждые 4 ч, но последняя (NEXT − 4 ч) ещё не отдана:
    // до NEXT 8 ч — как при интервале 8 ч, а шаг истории 4 ч
    state.history = historyRows(NEXT - H8, 400, H4);
    await service.get('bitcoin');
    const before = count().fundingRate;
    advance(SNAPSHOT_TTL_MS);
    await service.get('bitcoin');
    expect(count().fundingRate).toBeGreaterThan(before);
  });

  it('ответ с ошибкой биржи держится 30 с, потом биржа спрашивается снова', async () => {
    const { service, state, count, advance } = makeService();
    state.fail.add('okx');
    const first = await service.get('bitcoin');
    expect(first.openInterest.exchanges[1]).toHaveProperty('error');
    state.fail.delete('okx'); // OKX ожила
    advance(SNAPSHOT_TTL_MS - 1);
    const cached = await service.get('bitcoin');
    expect(cached.openInterest.exchanges[1]).toHaveProperty('error');
    expect(count().okx).toBe(1);
    advance(1);
    const fresh = await service.get('bitcoin');
    expect(fresh.openInterest.exchanges[1]).toMatchObject({
      exchange: 'okx',
      usd: okxUsd,
    });
    expect(count().okx).toBe(2);
  });

  it('кэш у монет раздельный', async () => {
    const { service, count } = makeService();
    await service.get('bitcoin');
    await service.get('solana');
    expect(count().premiumIndex).toBe(2);
  });

  it('неизвестная монета → 400 без запросов', async () => {
    const { service, count } = makeService();
    await expect(service.get('dogecoin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.get('__proto__')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(Object.values(count()).every((n) => n === 0)).toBe(true);
  });
});

// --- История OI (TASK-0008.3) ---
// Фейк по полному пути URL (не по подстроке: `openInterest` ловит и
// `openInterestHist`, research TASK-0008 «Риски»). Ответы — фикстура BTC
// 2026-10-28; листание — как у бирж (endTime включительно, end исключительно,
// курсор), как фейки sources.spec.ts. Ожидание — эталон T2 (scratchpad
// oi_oracle.py), а не вывод кода.
const OI_FX = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'oi-history-2026-10-28.json'),
    'utf8',
  ),
) as Raw;
const OI_NOW: number = OI_FX.capturedAt;
const HOUR = 3_600_000;
const MIN = 60_000;

type OiSource = 'binance' | 'okx' | 'bybit' | 'mark' | 'spot';
const oiSourceOf = (url: string): OiSource => {
  if (url.endsWith('/futures/data/openInterestHist')) return 'binance';
  if (url.endsWith('/rubik/stat/contracts/open-interest-history')) return 'okx';
  if (url.endsWith('/v5/market/open-interest')) return 'bybit';
  if (url.endsWith('/v5/market/mark-price-kline')) return 'mark';
  if (url.endsWith('/api/v3/klines')) return 'spot';
  throw new Error(`фейк: неожиданный URL ${url}`);
};
const OKX_PERIOD: Record<string, string> = { '1Dutc': '1Dutc', '1H': '1H' };
const MARK_IV: Record<string, string> = { D: 'D', '60': '60' };

const oiFake = () => {
  const calls: Record<OiSource, Raw[]> = {
    binance: [],
    okx: [],
    bybit: [],
    mark: [],
    spot: [],
  };
  const fail = new Set<OiSource>();
  const reply = (src: OiSource, p: Raw): unknown => {
    if (src === 'binance') {
      const rows = (OI_FX.binance[p.period] as Raw[]).filter(
        (r) => p.endTime === undefined || r.timestamp <= p.endTime,
      );
      return rows.slice(Math.max(0, rows.length - p.limit));
    }
    if (src === 'okx') {
      return {
        code: '0',
        msg: '',
        data: (OI_FX.okx[OKX_PERIOD[p.period]] as string[][])
          .filter((r) => p.end === undefined || Number(r[0]) < p.end)
          .slice(0, p.limit),
      };
    }
    if (src === 'bybit') {
      const rows = OI_FX.bybit[p.intervalTime] as Raw[];
      const at = p.cursor === undefined ? 0 : Number(p.cursor);
      const more = at + p.limit < rows.length;
      return {
        retCode: 0,
        result: {
          list: rows.slice(at, at + p.limit),
          nextPageCursor: more ? String(at + p.limit) : '',
        },
      };
    }
    if (src === 'mark') {
      return {
        retCode: 0,
        result: {
          list: (OI_FX.bybitMark[MARK_IV[p.interval]] as string[][]).filter(
            (r) => Number(r[0]) >= p.start && Number(r[0]) <= p.end,
          ),
        },
      };
    }
    return (OI_FX.spot[p.interval] as any[][])
      .filter((k) => k[0] >= p.startTime && k[0] <= p.endTime)
      .slice(0, p.limit);
  };
  const http = {
    get: (url: string, { params }: { params: Raw }) => {
      const src = oiSourceOf(url);
      calls[src].push(params);
      if (fail.has(src)) {
        return throwError(() => new Error(`${src}: ECONNREFUSED`));
      }
      return of({ data: reply(src, params), headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls, fail };
};

const makeOiService = () => {
  const { http, calls, fail } = oiFake();
  const service = new DerivativesService(http);
  let now = OI_NOW;
  service.clock = () => now;
  const total = () =>
    Object.values(calls).reduce((sum, list) => sum + list.length, 0);
  return { service, calls, fail, total, setNow: (t: number) => (now = t) };
};

const EXPECTED = OI_FX.expected as Record<OiStep, OiPoint[]>;

describe('DerivativesService.openInterestHistory', () => {
  jest.setTimeout(20_000);

  it.each([
    ['1d', 30],
    ['1h', 720],
  ] as const)(
    '%s: ряд = эталону T2 (%i точек), форма по контракту',
    async (step, count) => {
      const { service, calls } = makeOiService();
      const h = await service.openInterestHistory('bitcoin', step);
      expect(h).toEqual({
        coinId: 'bitcoin',
        market: 'BTC/USDT',
        step,
        exchanges: [
          { exchange: 'binance' },
          { exchange: 'okx' },
          { exchange: 'bybit' },
        ],
        priceError: null,
        points: EXPECTED[step],
      });
      expect(h.points).toHaveLength(count);
      // Шаг каждого источника — свой формат биржи
      expect(calls.okx[0].period).toBe(step === '1d' ? '1Dutc' : '1H');
      expect(calls.mark[0].interval).toBe(step === '1d' ? 'D' : '60');
      expect(calls.spot[0].interval).toBe(step);
      expect(calls.binance[0].period).toBe(step);
      expect(calls.bybit[0].intervalTime).toBe(step);
    },
  );

  it.each(['binance', 'okx', 'bybit'] as const)(
    'упала %s: ошибка в её поле, сумма — по двум остальным во всех точках',
    async (down) => {
      const { service, fail } = makeOiService();
      fail.add(down);
      const h = await service.openInterestHistory('bitcoin', '1d');
      expect(h.exchanges.find((e) => e.exchange === down)).toHaveProperty(
        'error',
      );
      expect(h.points).toHaveLength(30);
      h.points.forEach((p, i) => {
        const e = EXPECTED['1d'][i].byExchange;
        const rest = (['binance', 'okx', 'bybit'] as const).filter(
          (x) => x !== down,
        );
        expect(Object.keys(p.byExchange).sort()).toEqual([...rest].sort());
        expect(p.totalUsd).toBeCloseTo(e[rest[0]]! + e[rest[1]]!, 2);
      });
    },
  );

  it('упала только mark Bybit — Bybit «недоступен», без него в сумме', async () => {
    const { service, fail } = makeOiService();
    fail.add('mark');
    const h = await service.openInterestHistory('bitcoin', '1h');
    expect(h.exchanges[2]).toEqual({
      exchange: 'bybit',
      error: 'Bybit недоступен',
    });
    expect(h.points).toHaveLength(720);
    expect(h.points.every((p) => !('bybit' in p.byExchange))).toBe(true);
  });

  it('упал спот: priceError, ряд OI цел, price null', async () => {
    const { service, fail } = makeOiService();
    fail.add('spot');
    const h = await service.openInterestHistory('bitcoin', '1d');
    expect(h.priceError).toBe('Binance недоступен');
    expect(h.points.map((p) => p.totalUsd)).toEqual(
      EXPECTED['1d'].map((p) => p.totalUsd),
    );
    expect(h.points.every((p) => p.price === null)).toBe(true);
  });

  it('упало всё: points пуст, маршрут не бросает', async () => {
    const { service, fail } = makeOiService();
    for (const s of ['binance', 'okx', 'bybit', 'mark', 'spot'] as const) {
      fail.add(s);
    }
    const h = await service.openInterestHistory('bitcoin', '1h');
    expect(h.points).toEqual([]);
    expect(h.exchanges.every((e) => 'error' in e)).toBe(true);
  });

  it('кэш полного ряда: до следующего часа + 10 мин (выдержка OKX) — 0 запросов, после — заново', async () => {
    const { service, total, setNow } = makeOiService();
    await service.openInterestHistory('bitcoin', '1h');
    const first = total();
    const nextHour = Math.floor(OI_NOW / HOUR) * HOUR + HOUR;
    setNow(nextHour + 10 * MIN - 1);
    await service.openInterestHistory('bitcoin', '1h');
    expect(total()).toBe(first);
    setNow(nextHour + 10 * MIN);
    await service.openInterestHistory('bitcoin', '1h');
    expect(total()).toBeGreaterThan(first);
  });

  it('ответ с ошибкой биржи держится 60 с, потом биржи спрашиваются снова', async () => {
    const { service, fail, calls, setNow } = makeOiService();
    fail.add('okx');
    await service.openInterestHistory('bitcoin', '1d');
    setNow(OI_NOW + 60_000 - 1);
    await service.openInterestHistory('bitcoin', '1d');
    expect(calls.okx).toHaveLength(1);
    setNow(OI_NOW + 60_000);
    await service.openInterestHistory('bitcoin', '1d');
    expect(calls.okx).toHaveLength(2);
  });

  it('последний момент ещё не опубликован — не кэшируется на час, повтор через 60 с', async () => {
    const { service, calls, setNow } = makeOiService();
    // now на час позже снимка: точки за этот час в фикстуре нет
    const later = OI_NOW + HOUR;
    setNow(later);
    const h = await service.openInterestHistory('bitcoin', '1h');
    expect(h.points.at(-1)!.t).toBeLessThan(Math.floor(later / HOUR) * HOUR);
    setNow(later + 60_000);
    await service.openInterestHistory('bitcoin', '1h');
    expect(calls.binance.length).toBeGreaterThan(2);
  });

  // Ноль в строке OKX (замер T4) — дыра в одном моменте: такой ряд не
  // «полный» и не держится до следующего часа, а спрашивается через 60 с
  it('дыра от нуля у OKX: остальные точки на месте, повтор через 60 с', async () => {
    const rows = OI_FX.okx['1H'] as string[][];
    const i = 200;
    const saved = rows[i];
    rows[i] = [saved[0], '0', '0', '0'];
    try {
      const { service, calls, setNow } = makeOiService();
      const h = await service.openInterestHistory('bitcoin', '1h');
      const gapT = Number(saved[0]) + HOUR; // момент OKX = метка + шаг
      expect(h.points).toHaveLength(719);
      expect(h.points.some((p) => p.t === gapT)).toBe(false);
      expect(h.exchanges[1]).toEqual({ exchange: 'okx' });
      setNow(OI_NOW + 60_000);
      await service.openInterestHistory('bitcoin', '1h');
      expect(calls.okx.length).toBeGreaterThan(8);
    } finally {
      rows[i] = saved;
    }
  });

  it('шаги и монеты — раздельные записи кэша', async () => {
    const { service, calls } = makeOiService();
    await service.openInterestHistory('bitcoin', '1d');
    await service.openInterestHistory('bitcoin', '1h');
    await service.openInterestHistory('ethereum', '1d');
    expect(
      calls.binance.map((p) => [p.symbol as string, p.period as string]),
    ).toEqual([
      ['BTCUSDT', '1d'],
      ['BTCUSDT', '1h'],
      ['BTCUSDT', '1h'],
      ['ETHUSDT', '1d'],
    ]);
    // Символ монеты — у всех пяти источников, не только у Binance (критик T3)
    expect(calls.okx.at(-1)!.instId).toBe('ETH-USDT-SWAP');
    expect(calls.bybit.at(-1)!.symbol).toBe('ETHUSDT');
    expect(calls.mark.at(-1)!.symbol).toBe('ETHUSDT');
    expect(calls.spot.at(-1)!.symbol).toBe('ETHUSDT');
  });

  // Дневное правило кэша (критик T3): на 1h шаг и час совпадают, и мутант
  // «час вместо шага» в lastMoment/until там не виден
  const DAY_MS = 24 * HOUR;
  const nextDay = Math.floor(OI_NOW / DAY_MS) * DAY_MS + DAY_MS;

  it('1d: полный ряд (последняя точка — сегодня 00:00) держится до 00:10 следующих суток', async () => {
    const { service, total, setNow } = makeOiService();
    const h = await service.openInterestHistory('bitcoin', '1d');
    expect(h.points.at(-1)!.t).toBe(nextDay - DAY_MS);
    const first = total();
    setNow(nextDay + 10 * MIN - 1);
    await service.openInterestHistory('bitcoin', '1d');
    expect(total()).toBe(first);
    setNow(nextDay + 10 * MIN);
    await service.openInterestHistory('bitcoin', '1d');
    expect(total()).toBeGreaterThan(first);
  });

  it('1d, 00:00:30: точка за сегодня ещё не опубликована — повтор через 60 с, а не через сутки', async () => {
    const { service, calls, setNow } = makeOiService();
    const t0 = nextDay + 30_000;
    setNow(t0);
    const h = await service.openInterestHistory('bitcoin', '1d');
    expect(h.points.at(-1)!.t).toBe(nextDay - DAY_MS); // вчерашняя
    setNow(t0 + 60_000 - 1);
    await service.openInterestHistory('bitcoin', '1d');
    expect(calls.binance).toHaveLength(1);
    setNow(t0 + 60_000);
    await service.openInterestHistory('bitcoin', '1d');
    expect(calls.binance).toHaveLength(2);
  });

  it.each([
    ['dogecoin', '1d', /монета/],
    ['bitcoin', '4h', /шаг/],
    ['bitcoin', undefined, /шаг/],
  ])('%s, шаг %s → 400 без запросов', async (coin, step, msg) => {
    const { service, total } = makeOiService();
    const call = service.openInterestHistory(coin, step as unknown as string);
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.openInterestHistory(coin, step as unknown as string),
    ).rejects.toThrow(msg);
    expect(total()).toBe(0);
  });
});
