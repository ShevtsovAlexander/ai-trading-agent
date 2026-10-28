import { readFileSync } from 'fs';
import { join } from 'path';
import { Candle } from '../market/market.types';
import { OiPoint, OiStep } from './derivatives.types';
import { OiSeriesInput, buildOiSeries } from './oi-history';
import { OiRow } from './sources';

// Оракул — эталон независимого скрипта (scratchpad oi_oracle.py: сетка
// моментов от now назад) на тех же сырых ответах BTC, снимок 2026-10-28.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call --
   поля фикстуры — сырой JSON бирж */
type Raw = Record<string, any>;
const FX = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'oi-history-2026-10-28.json'),
    'utf8',
  ),
) as Raw;
const NOW: number = FX.capturedAt;
const HOUR = 3_600_000;
const OI_STEP: Record<OiStep, number> = { '1d': 24 * HOUR, '1h': HOUR };

const KEYS: Record<OiStep, Record<string, string>> = {
  '1d': { binance: '1d', okx: '1Dutc', bybit: '1d', mark: 'D', spot: '1d' },
  '1h': { binance: '1h', okx: '1H', bybit: '1h', mark: '60', spot: '1h' },
};

// Сырые ответы → вход функции, как их отдали бы sources.ts и klines.ts
// (метки как у биржи, закрытые свечи — closeTime ≤ now)
const inputFor = (step: OiStep): OiSeriesInput => {
  const k = KEYS[step];
  const binance: OiRow[] = FX.binance[k.binance].map((r: Raw) => ({
    t: Number(r.timestamp),
    usd: Number(r.sumOpenInterestValue),
  }));
  const okx: OiRow[] = FX.okx[k.okx].map((r: string[]) => ({
    t: Number(r[0]),
    usd: Number(r[3]),
  }));
  const rows: OiRow[] = FX.bybit[k.bybit].map((r: Raw) => ({
    t: Number(r.timestamp),
    coin: Number(r.openInterest),
  }));
  const marks = new Map<number, number>(
    FX.bybitMark[k.mark].map((r: string[]) => [Number(r[0]), Number(r[1])]),
  );
  const spot: Candle[] = FX.spot[k.spot]
    .filter((c: any[]) => Number(c[6]) <= NOW)
    .map((c: any[]) => ({
      t: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
    }));
  return { step, now: NOW, binance, okx, bybit: { rows, marks }, spot };
};

describe('buildOiSeries против эталона', () => {
  it.each([
    ['1d', 30],
    ['1h', 720],
  ] as const)('%s: %i точек, все поля = эталону', (step, count) => {
    const expected = FX.expected[step] as OiPoint[];
    const got = buildOiSeries(inputFor(step));
    expect(got).toHaveLength(count);
    expect(got).toEqual(expected);
  });

  it('1h: точки на сетке часа, шаг ровно час, последняя ≤ now', () => {
    const got = buildOiSeries(inputFor('1h'));
    for (const p of got) expect(p.t % HOUR).toBe(0);
    for (let i = 1; i < got.length; i++) {
      expect(got[i].t - got[i - 1].t).toBe(HOUR);
    }
    expect(got.at(-1)!.t).toBeLessThanOrEqual(NOW);
    expect(got[0].t).toBeGreaterThan(NOW - 30 * 24 * HOUR);
  });
});

describe('buildOiSeries: неполные данные', () => {
  it('у одной биржи нет метки — в этот момент дыра, а не сумма по двум', () => {
    const input = inputFor('1h');
    const gapT = FX.expected['1h'][300].t as number;
    // У OKX момент = метка + шаг: убираем метку, дающую момент gapT
    input.okx = input.okx!.filter((r) => r.t !== gapT - HOUR);
    const got = buildOiSeries(input);
    expect(got).toHaveLength(719);
    expect(got.find((p) => p.t === gapT)).toBeUndefined();
    expect(got.find((p) => p.t === gapT + HOUR)).toEqual(
      FX.expected['1h'][301],
    );
  });

  it('нет mark Bybit в момент — дыра', () => {
    const input = inputFor('1d');
    const gapT = FX.expected['1d'][10].t as number;
    input.bybit!.marks.delete(gapT);
    const got = buildOiSeries(input);
    expect(got).toHaveLength(29);
    expect(got.find((p) => p.t === gapT)).toBeUndefined();
  });

  it('биржа null — выпадает из всех точек; сумма — по двум учтённым', () => {
    const input = inputFor('1d');
    input.okx = null;
    const got = buildOiSeries(input);
    const expected = FX.expected['1d'] as OiPoint[];
    expect(got).toHaveLength(30);
    got.forEach((p, i) => {
      const e = expected[i];
      expect(p.t).toBe(e.t);
      expect(p.byExchange).toEqual({
        binance: e.byExchange.binance,
        bybit: e.byExchange.bybit,
      });
      expect(p.totalUsd).toBe(e.byExchange.binance! + e.byExchange.bybit!);
    });
  });

  // Binance сам не отдаёт глубже 30 дней — левый край окна держит его
  // предел, а не код. Без Binance моменты берутся у OKX и Bybit, у которых
  // в фикстуре есть строки старше окна (мутант «без левого края», T2)
  it.each([
    ['1d', 30],
    ['1h', 720],
  ] as const)(
    'Binance null (%s): левый край окна — 30 дней, строки старше не попадают',
    (step, count) => {
      const input = inputFor(step);
      const expected = FX.expected[step] as OiPoint[];
      expect(
        Math.min(...input.okx!.map((r) => r.t)) + OI_STEP[step],
      ).toBeLessThanOrEqual(NOW - 30 * 24 * HOUR);
      const got = buildOiSeries({ ...input, binance: null });
      expect(got).toHaveLength(count);
      expect(got.map((p) => p.t)).toEqual(expected.map((p) => p.t));
    },
  );

  it('все биржи null — пустой ряд', () => {
    const input = inputFor('1d');
    expect(
      buildOiSeries({ ...input, binance: null, okx: null, bybit: null }),
    ).toEqual([]);
  });

  it('спот null — ряд OI цел, price null у всех точек', () => {
    const got = buildOiSeries({ ...inputFor('1h'), spot: null });
    const expected = FX.expected['1h'] as OiPoint[];
    expect(got.map((p) => p.totalUsd)).toEqual(expected.map((p) => p.totalUsd));
    expect(got.every((p) => p.price === null)).toBe(true);
  });

  it('метки позже now (живая строка, будущее) в ряд не попадают', () => {
    const input = inputFor('1h');
    // now на 3 часа раньше снимка: последние моменты бирж — за правым краем
    const now = NOW - 3 * HOUR;
    const got = buildOiSeries({ ...input, now });
    expect(got.at(-1)!.t).toBeLessThanOrEqual(now);
    expect(got.at(-1)!.t).toBe(Math.floor(now / HOUR) * HOUR);
  });
});
