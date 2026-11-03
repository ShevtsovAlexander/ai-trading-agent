/**
 * classifyRegime: известные ответы на ручных рядах + эталон на всей дневной
 * истории BTC — ярлыки независимого скрипта Python (правило замера T1,
 * порог 25) на ADX technicalindicators.
 *
 * Правильность ярлыка как «режима рынка» не проверяема — только
 * соответствие правилу (tasklist TASK-0011.3).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import * as ti from 'technicalindicators';
import { Regime, RegimePoint, classifyRegime } from './regime';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

const DAILY = fixture('klines-1d-btc-2026-11-02.json') as [
  number,
  number,
  number,
  number,
][];
const ORACLE = fixture('regime-btc-oracle.json') as {
  threshold: number;
  firstT: number;
  labels: string;
  since: number;
  sinceT: number;
};
const CODE: Record<string, Regime> = { u: 'up', d: 'down', r: 'range' };

// Точка с t = номер дня
const pt = (adx: number, pdi: number, mdi: number, t = 0): RegimePoint => ({
  t,
  adx,
  pdi,
  mdi,
});

describe('classifyRegime — известные ответы', () => {
  it('ровно на черте — тренд, чуть ниже — боковик', () => {
    const { labels } = classifyRegime(
      [pt(25, 30, 10), pt(24.99, 30, 10), pt(25, 10, 30), pt(24.99, 10, 30)],
      25,
    );
    expect(labels).toEqual(['up', 'range', 'down', 'range']);
  });

  it('переходы вверх → вниз → боковик → вверх', () => {
    const { labels, since } = classifyRegime(
      [
        pt(30, 30, 10),
        pt(31, 30, 10),
        pt(32, 10, 30),
        pt(20, 10, 30),
        pt(26, 30, 10),
        pt(27, 30, 10),
      ],
      25,
    );
    expect(labels).toEqual(['up', 'up', 'down', 'range', 'up', 'up']);
    expect(since).toBe(4);
  });

  it('+DI = −DI при тренде держит прошлый трендовый ярлык, после боковика — боковик', () => {
    const { labels } = classifyRegime(
      [
        pt(30, 30, 10),
        pt(30, 20, 20),
        pt(30, 10, 30),
        pt(30, 20, 20),
        pt(10, 20, 20),
        pt(30, 20, 20),
      ],
      25,
    );
    expect(labels).toEqual(['up', 'up', 'down', 'down', 'range', 'range']);
  });

  it('since — первый день последней серии, а не ряда', () => {
    expect(
      classifyRegime([pt(10, 1, 2), pt(30, 30, 10), pt(30, 30, 10)], 25).since,
    ).toBe(1);
    // весь ряд — одна серия
    expect(
      classifyRegime([pt(10, 1, 2), pt(11, 1, 2), pt(12, 1, 2)], 25).since,
    ).toBe(0);
    // последний день — новая серия из одного дня
    expect(
      classifyRegime([pt(30, 30, 10), pt(30, 30, 10), pt(10, 1, 2)], 25).since,
    ).toBe(2);
  });

  it('ряд из одной точки и пустой ряд', () => {
    expect(classifyRegime([pt(40, 10, 30)], 25)).toEqual({
      labels: ['down'],
      since: 0,
    });
    expect(classifyRegime([], 25)).toEqual({ labels: [], since: -1 });
  });
});

describe('classifyRegime — вся дневная история BTC против эталона Python', () => {
  const ref = ti.ADX.calculate({
    high: DAILY.map((k) => k[1]),
    low: DAILY.map((k) => k[2]),
    close: DAILY.map((k) => k[3]),
    period: 14,
  });
  const offset = DAILY.length - ref.length;
  const points = ref.map((r, j) =>
    pt(r.adx, r.pdi, r.mdi, DAILY[j + offset][0]),
  );

  it('эталон — на тех же днях', () => {
    expect(ORACLE.threshold).toBe(25);
    expect(ORACLE.labels.length).toBe(points.length);
    expect(ORACLE.firstT).toBe(points[0].t);
  });

  it('ярлык каждого дня и начало последней серии совпадают с эталоном', () => {
    const { labels, since } = classifyRegime(points, 25);
    const bad = labels
      .map((l, i) => (l === CODE[ORACLE.labels[i]] ? null : `${i}: ${l}`))
      .filter((x) => x !== null);
    expect(bad).toEqual([]);
    expect(since).toBe(ORACLE.since);
    expect(points[since].t).toBe(ORACLE.sinceT);
  });

  it('эталон не вырожден: все три ярлыка и смены режима есть', () => {
    const counts = { u: 0, d: 0, r: 0 } as Record<string, number>;
    let changes = 0;
    for (let i = 0; i < ORACLE.labels.length; i++) {
      counts[ORACLE.labels[i]]++;
      if (i > 0 && ORACLE.labels[i] !== ORACLE.labels[i - 1]) changes++;
    }
    expect(counts.u).toBeGreaterThan(500);
    expect(counts.d).toBeGreaterThan(500);
    expect(counts.r).toBeGreaterThan(500);
    expect(changes).toBeGreaterThan(100);
  });
});
