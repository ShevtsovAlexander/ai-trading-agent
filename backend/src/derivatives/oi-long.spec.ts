/**
 * OI 1Г и «Всё» (TASK-0017): разбор и ряд — реальные ответы Coinalyze и свечи
 * Binance (фикстура снята параметрами кода) против эталона Python
 * `scripts/oi-long-oracle.py`, посчитанного вне проекта; края — известный ответ
 * на ручных рядах.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { Candle } from '../market/market.types';
import { LIQUIDATION_SYMBOLS } from '../liquidations/liquidations.types';
import { Exchange, OiPoint } from './derivatives.types';
import {
  OI_LONG_FROM,
  OiBar,
  buildOiLongSeries,
  fetchOiHistoryCoinalyze,
  parseOiHistory,
} from './oi-long';

type Raw = { symbol: string; history: Record<string, number>[] }[];
type Row = [
  number,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
];
const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'oi-long-2026-11-09.json'), 'utf8'),
) as {
  takenAt: number;
  responses: Record<string, { coinalyze: Raw; klines: (number | string)[][] }>;
  expected: Record<
    string,
    {
      all: Row[];
      '1y': Row[];
      without: Record<Exchange, Row[]>;
      gap: { exchange: Exchange; t: number; all: Row[] };
    }
  >;
};
const COINS = ['bitcoin', 'ethereum', 'solana'];
const EXCHANGES: Exchange[] = ['binance', 'okx', 'bybit'];
const DAY = 86_400_000;
const now = FX.takenAt;

const symbols = (coin: string) =>
  EXCHANGES.map((e) => LIQUIDATION_SYMBOLS[coin][e]);

// Ответ → ряды по биржам, как будет делать сервис
const rowsOf = (coin: string, except?: Exchange) => {
  const parsed = parseOiHistory(FX.responses[coin].coinalyze, symbols(coin));
  const rows: Partial<Record<Exchange, OiBar[]>> = {};
  for (const e of EXCHANGES) {
    if (e !== except) rows[e] = parsed.get(LIQUIDATION_SYMBOLS[coin][e])!;
  }
  return rows;
};

// Закрытые свечи — как fetchClosedCandles: closeTime в будущем отброшена
const spotOf = (coin: string): Candle[] =>
  FX.responses[coin].klines
    .filter((k) => (k[6] as number) <= now)
    .map((k) => ({
      t: k[0] as number,
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));

// Строка эталона → точка: выпавшей биржи в byExchange нет совсем
const toPoint = ([t, total, b, o, y, price]: Row): OiPoint => {
  const byExchange: Partial<Record<Exchange, number>> = {};
  [b, o, y].forEach((v, i) => {
    if (v !== null) byExchange[EXCHANGES[i]] = v;
  });
  return { t, totalUsd: total, byExchange, price };
};

describe('parseOiHistory', () => {
  it('реальный ответ: 3 символа × 1502 дня, секунды → мс, c → usd', () => {
    for (const coin of COINS) {
      const raw = FX.responses[coin].coinalyze;
      const parsed = parseOiHistory(raw, symbols(coin));
      expect([...parsed.keys()].sort()).toEqual([...symbols(coin)].sort());
      for (const row of raw) {
        const bars = parsed.get(row.symbol)!;
        expect(bars).toHaveLength(1502);
        expect(bars).toEqual(
          row.history.map((p) => ({ t: p.t * 1000, usd: p.c })),
        );
      }
    }
  });

  it('символа нет в ответе — его нет в словаре, остальные на месте', () => {
    const raw = FX.responses.bitcoin.coinalyze.filter(
      (r) => r.symbol !== 'BTCUSDT_PERP.3',
    );
    const parsed = parseOiHistory(raw, symbols('bitcoin'));
    expect(parsed.has('BTCUSDT_PERP.3')).toBe(false);
    expect(parsed.size).toBe(2);
  });

  it('OI 0 — день пропущен, а не ошибка', () => {
    const raw = [
      {
        symbol: 'A',
        history: [
          { t: 86400, c: 5 },
          { t: 172800, c: 0 },
        ],
      },
    ];
    expect(parseOiHistory(raw, ['A']).get('A')).toEqual([{ t: DAY, usd: 5 }]);
  });

  const broken: [string, unknown, RegExp][] = [
    ['не массив', { error: 'x' }, /ответ не массив/],
    ['чужой символ', [{ symbol: 'X', history: [] }], /чужой символ X/],
    ['без history', [{ symbol: 'A' }], /A без history/],
    ['c строкой', [{ symbol: 'A', history: [{ t: 86400, c: '5' }] }], /поле c/],
    ['c минус', [{ symbol: 'A', history: [{ t: 86400, c: -1 }] }], /поле c/],
    ['c NaN', [{ symbol: 'A', history: [{ t: 86400, c: NaN }] }], /поле c/],
    [
      'c Infinity',
      [{ symbol: 'A', history: [{ t: 86400, c: Infinity }] }],
      /поле c/,
    ],
    ['нет c', [{ symbol: 'A', history: [{ t: 86400 }] }], /поле c/],
    ['t строкой', [{ symbol: 'A', history: [{ t: '86400', c: 1 }] }], /поле t/],
    ['t дробное', [{ symbol: 'A', history: [{ t: 86400.5, c: 1 }] }], /поле t/],
    [
      't не на дне',
      [{ symbol: 'A', history: [{ t: 86400 + 3600, c: 1 }] }],
      /не на начале дня/,
    ],
    [
      'дубль t',
      [
        {
          symbol: 'A',
          history: [
            { t: 86400, c: 1 },
            { t: 86400, c: 2 },
          ],
        },
      ],
      /дубль метки/,
    ],
  ];
  it.each(broken)(
    'порча: %s — ошибка с именем источника',
    (_, raw, message) => {
      expect(() => parseOiHistory(raw, ['A'])).toThrow(/^Coinalyze: /);
      expect(() => parseOiHistory(raw, ['A'])).toThrow(message);
    },
  );
});

describe('buildOiLongSeries против эталона Python', () => {
  it.each(COINS)('%s: «Всё» — все точки точно, 1501 момент без дыр', (coin) => {
    const points = buildOiLongSeries({
      period: 'all',
      now,
      rows: rowsOf(coin),
      spot: spotOf(coin),
    });
    expect(points).toEqual(FX.expected[coin].all.map(toPoint));
    expect(points).toHaveLength(1501);
    expect(points[0].t).toBe(OI_LONG_FROM + DAY);
  });

  it.each(COINS)('%s: 1Г — последние 365 точек точно', (coin) => {
    const points = buildOiLongSeries({
      period: '1y',
      now,
      rows: rowsOf(coin),
      spot: spotOf(coin),
    });
    expect(points).toEqual(FX.expected[coin]['1y'].map(toPoint));
    expect(points).toHaveLength(365);
  });

  const cases = COINS.flatMap((c) => EXCHANGES.map((e) => [c, e] as const));
  it.each(cases)(
    '%s без %s — биржа выпадает из всех точек, сумма по двум',
    (coin, except) => {
      const points = buildOiLongSeries({
        period: 'all',
        now,
        rows: rowsOf(coin, except),
        spot: spotOf(coin),
      });
      expect(points).toEqual(FX.expected[coin].without[except].map(toPoint));
      expect(points.every((p) => !(except in p.byExchange))).toBe(true);
    },
  );

  it.each(COINS)(
    '%s: у одной биржи пропал день — дыра в этом моменте',
    (coin) => {
      const { exchange, t } = FX.expected[coin].gap;
      const rows = rowsOf(coin);
      rows[exchange] = rows[exchange]!.filter((b) => b.t !== t);
      const points = buildOiLongSeries({
        period: 'all',
        now,
        rows,
        spot: spotOf(coin),
      });
      expect(points).toEqual(FX.expected[coin].gap.all.map(toPoint));
      expect(points.some((p) => p.t === t + DAY)).toBe(false);
    },
  );

  it('сумма — в порядке binance → okx → bybit, а не в порядке ключей', () => {
    for (const coin of COINS) {
      const rows = rowsOf(coin);
      const reversed: Partial<Record<Exchange, OiBar[]>> = {
        bybit: rows.bybit,
        okx: rows.okx,
        binance: rows.binance,
      };
      const points = buildOiLongSeries({
        period: 'all',
        now,
        rows: reversed,
        spot: spotOf(coin),
      });
      expect(points.map((p) => p.totalUsd)).toEqual(
        FX.expected[coin].all.map((r) => r[1]),
      );
    }
  });
});

describe('buildOiLongSeries: известный ответ', () => {
  const D0 = Date.UTC(2026, 0, 1);
  const bars = (vals: number[]): OiBar[] =>
    vals.map((usd, i) => ({ t: D0 + i * DAY, usd }));
  const candle = (t: number, close: number): Candle => ({
    t,
    open: 0,
    high: 0,
    low: 0,
    close,
    volume: 0,
  });

  it('момент = метка + сутки; бар, чей момент позже now, — живой день, отброшен', () => {
    const rows = { binance: bars([1, 2, 3]) };
    // now — ровно момент второго бара: третий (момент D0 + 3 сут.) ещё идёт
    const points = buildOiLongSeries({
      period: 'all',
      now: D0 + 2 * DAY,
      rows,
      spot: null,
    });
    expect(points.map((p) => p.t)).toEqual([D0 + DAY, D0 + 2 * DAY]);
    expect(points.map((p) => p.totalUsd)).toEqual([1, 2]);
    // на миллисекунду раньше — второго тоже нет
    expect(
      buildOiLongSeries({
        period: 'all',
        now: D0 + 2 * DAY - 1,
        rows,
        spot: null,
      }),
    ).toHaveLength(1);
  });

  it('цена — close свечи, открытой в момент − сутки; нет свечи — null', () => {
    const rows = {
      binance: bars([1, 2, 3]),
      okx: bars([10, 20, 30]),
      bybit: bars([100, 200, 300]),
    };
    const spot = [
      candle(D0, 50), // закрылась в D0 + сутки — цена первой точки
      // свечи D0 + сутки нет — у второй точки цены нет
      candle(D0 + 2 * DAY, 70),
      candle(D0 + 3 * DAY, 99), // открыта в момент третьей точки — не её цена
    ];
    const points = buildOiLongSeries({
      period: 'all',
      now: D0 + 3 * DAY,
      rows,
      spot,
    });
    expect(points.map((p) => p.price)).toEqual([50, null, 70]);
    expect(points[0]).toEqual({
      t: D0 + DAY,
      totalUsd: 111,
      byExchange: { binance: 1, okx: 10, bybit: 100 },
      price: 50,
    });
  });

  it('спот недоступен — ряд OI цел, price null у всех', () => {
    const points = buildOiLongSeries({
      period: 'all',
      now: D0 + 5 * DAY,
      rows: { okx: bars([1, 2]) },
      spot: null,
    });
    expect(points.map((p) => p.price)).toEqual([null, null]);
  });

  it('ни одной биржи — пустой ряд', () => {
    expect(
      buildOiLongSeries({
        period: 'all',
        now: D0 + 5 * DAY,
        rows: {},
        spot: [],
      }),
    ).toEqual([]);
  });

  it('1Г на коротком ряде — все точки, без выдуманных', () => {
    const points = buildOiLongSeries({
      period: '1y',
      now: D0 + 9 * DAY,
      rows: { binance: bars([1, 2, 3]) },
      spot: null,
    });
    expect(points).toHaveLength(3);
  });

  it('метки не по порядку — точки всё равно по возрастанию момента (критик 17.2)', () => {
    const shuffled = [2, 0, 1].map((i) => ({ t: D0 + i * DAY, usd: i + 1 }));
    const points = buildOiLongSeries({
      period: 'all',
      now: D0 + 9 * DAY,
      rows: { binance: shuffled, okx: [...shuffled].reverse() },
      spot: null,
    });
    expect(points.map((p) => p.t)).toEqual([
      D0 + DAY,
      D0 + 2 * DAY,
      D0 + 3 * DAY,
    ]);
  });

  it('бар раньше OI_LONG_FROM не берётся (критик 17.2)', () => {
    const early = { t: OI_LONG_FROM - DAY, usd: 7 };
    const first = { t: OI_LONG_FROM, usd: 8 };
    const points = buildOiLongSeries({
      period: 'all',
      now: OI_LONG_FROM + 5 * DAY,
      rows: { binance: [early, first] },
      spot: null,
    });
    expect(points.map((p) => p.t)).toEqual([OI_LONG_FROM + DAY]);
  });
});

describe('fetchOiHistoryCoinalyze', () => {
  it('один GET: ключ заголовком, секунды целые, daily, USD, символы через запятую', async () => {
    const get = jest
      .fn()
      .mockReturnValue(of({ data: FX.responses.solana.coinalyze }));
    const http = { get } as unknown as HttpService;
    const map = await fetchOiHistoryCoinalyze(
      http,
      'ключ',
      symbols('solana'),
      OI_LONG_FROM,
      now,
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      'https://api.coinalyze.net/v1/open-interest-history',
      {
        headers: { api_key: 'ключ' },
        params: {
          symbols: 'SOLUSDT_PERP.A,SOLUSDT_PERP.3,SOLUSDT.6',
          interval: 'daily',
          from: OI_LONG_FROM / 1000,
          to: Math.floor(now / 1000),
          convert_to_usd: 'true',
        },
      },
    );
    expect(map.size).toBe(3);
  });
});
