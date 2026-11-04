/**
 * Сравнение calcEMA / calcRSI / calcMACD / calcBB / calcSMA / calcADX из indicators.ts
 * с библиотекой technicalindicators на одних и тех же ценах.
 *
 * Запуск: npm run test -- indicators
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import * as ti from 'technicalindicators';
import {
  calcADX,
  calcBB,
  calcEMA,
  calcMACD,
  calcRSI,
  calcSMA,
} from './indicators';

// ---------------------------------------------------------------------------
// Детерминированные тестовые цены (50 значений) — синусоида + линейный тренд
// ---------------------------------------------------------------------------
const PRICES = Array.from({ length: 50 }, (_, i) =>
  parseFloat((100 + i * 0.5 + Math.sin(i * 0.4) * 8).toFixed(6)),
);

const TOLERANCE = 0.0001; // допустимое расхождение (0.01%)

// Вспомогательная функция: сравнивает два числа с допуском
function near(a: number, b: number, tol = TOLERANCE): boolean {
  if (!isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) / (Math.abs(b) || 1) <= tol;
}

// ---------------------------------------------------------------------------
// EMA
// ---------------------------------------------------------------------------
describe('calcEMA vs technicalindicators.EMA', () => {
  [9, 21, 26].forEach((period) => {
    it(`EMA(${period}) — последние 10 значений совпадают с точностью ${TOLERANCE}`, () => {
      const mine: number[] = calcEMA(PRICES, period);

      // TI возвращает компактный массив без NaN-префикса
      // mine[period-1] соответствует ti[0], mine[i] → ti[i - (period-1)]
      const tiResult: number[] = ti.EMA.calculate({ period, values: PRICES });
      const offset = period - 1;

      const discrepancies: string[] = [];

      for (let ti_i = 0; ti_i < tiResult.length; ti_i++) {
        const my_i = ti_i + offset;
        const myVal = mine[my_i];
        const tiVal = tiResult[ti_i];

        if (!near(myVal, tiVal)) {
          discrepancies.push(
            `idx=${my_i}: mine=${myVal?.toFixed(6)} ti=${tiVal?.toFixed(6)} diff=${Math.abs(myVal - tiVal).toFixed(6)}`,
          );
        }
      }

      if (discrepancies.length > 0) {
        console.log(
          `\n=== EMA(${period}) расхождения (${discrepancies.length}/${tiResult.length}): ===`,
        );
        discrepancies.slice(0, 10).forEach((d) => console.log(' ', d));
      } else {
        console.log(
          `EMA(${period}): все ${tiResult.length} значений совпадают ✓`,
        );
      }

      expect(discrepancies.length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// RSI
// ---------------------------------------------------------------------------
describe('calcRSI vs technicalindicators.RSI', () => {
  // Эталон округляет RSI до 2 знаков (toFixed(2) в technicalindicators),
  // поэтому допуск абсолютный: относительный 0.01% при RSI около 50 съедается
  // самим округлением.
  const RSI_TOLERANCE = 0.005 + 1e-9;

  it('RSI(14) — все значения совпадают с точностью 0.005 (эталон округляет до 2 знаков)', () => {
    const mine: number[] = calcRSI(PRICES, 14);

    // TI RSI: первое значение соответствует mine[14]
    const tiResult: number[] = ti.RSI.calculate({ period: 14, values: PRICES });
    const offset = 14;

    const discrepancies: string[] = [];

    for (let ti_i = 0; ti_i < tiResult.length; ti_i++) {
      const my_i = ti_i + offset;
      const myVal = mine[my_i];
      const tiVal = tiResult[ti_i];

      if (!isFinite(myVal) || Math.abs(myVal - tiVal) > RSI_TOLERANCE) {
        discrepancies.push(
          `idx=${my_i}: mine=${myVal?.toFixed(4)} ti=${tiVal?.toFixed(4)} diff=${Math.abs(myVal - tiVal).toFixed(4)}`,
        );
      }
    }

    if (discrepancies.length > 0) {
      console.log(
        `\n=== RSI(14) расхождения (${discrepancies.length}/${tiResult.length}): ===`,
      );
      discrepancies.forEach((d) => console.log(' ', d));
    } else {
      console.log(`RSI(14): все ${tiResult.length} значений совпадают ✓`);
    }

    expect(discrepancies.length).toBe(0);
    // Пустой эталон прошёл бы цикл выше без единой проверки
    expect(tiResult.length).toBe(PRICES.length - offset);
    // RSI валиден с индекса period — до него значений быть не должно
    expect(mine.slice(0, offset).every(Number.isNaN)).toBe(true);
  });

  // В PRICES нет 14 дельт одного знака подряд, поэтому ветки avgLoss = 0 /
  // avgGain = 0 основной тест не проходит. Ровный ряд — оба нуля сразу:
  // эталон сначала проверяет avgLoss и отдаёт 100.
  [
    { name: 'ровный ряд', values: Array.from({ length: 20 }, () => 100) },
    {
      name: 'монотонный рост',
      values: Array.from({ length: 20 }, (_, i) => 100 + i),
    },
    {
      name: 'монотонное падение',
      values: Array.from({ length: 20 }, (_, i) => 100 - i),
    },
  ].forEach(({ name, values }) => {
    it(`RSI(14) — ${name} совпадает с эталоном`, () => {
      const mine = calcRSI(values, 14).slice(14);
      const tiResult = ti.RSI.calculate({ period: 14, values });

      expect(tiResult.length).toBe(values.length - 14);
      expect(mine).toEqual(tiResult);
    });
  });
});

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------
describe('calcMACD vs technicalindicators.MACD', () => {
  it('MACD line совпадает начиная с индекса 25', () => {
    const mine = calcMACD(PRICES);

    const tiResult = ti.MACD.calculate({
      values: PRICES,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    // TI возвращает компактный массив; первый элемент = индекс 25 у mine
    const macdOffset = 25;
    const discrepanciesMacd: string[] = [];
    const discrepanciesSignal: string[] = [];
    const discrepanciesHist: string[] = [];

    tiResult.forEach((row, ti_i) => {
      const my_i = ti_i + macdOffset;

      // MACD line
      if (row.MACD !== undefined) {
        const myVal = mine.macd[my_i];
        const tiVal = row.MACD;
        if (!near(myVal, tiVal)) {
          discrepanciesMacd.push(
            `idx=${my_i}: mine=${myVal?.toFixed(6)} ti=${tiVal?.toFixed(6)}`,
          );
        }
      }

      // Signal line (только когда TI его возвращает)
      if (row.signal !== undefined) {
        const myVal = mine.signal[my_i];
        const tiVal = row.signal;
        if (!near(myVal, tiVal)) {
          discrepanciesSignal.push(
            `idx=${my_i}: mine=${myVal?.toFixed(6)} ti=${tiVal?.toFixed(6)}`,
          );
        }
      }

      // Histogram
      if (row.histogram !== undefined) {
        const myVal = mine.histogram[my_i];
        const tiVal = row.histogram;
        if (!near(myVal, tiVal)) {
          discrepanciesHist.push(
            `idx=${my_i}: mine=${myVal?.toFixed(6)} ti=${tiVal?.toFixed(6)}`,
          );
        }
      }
    });

    const groups: [string, string[]][] = [
      ['MACD line', discrepanciesMacd],
      ['Signal', discrepanciesSignal],
      ['Histogram', discrepanciesHist],
    ];
    groups.forEach(([name, arr]) => {
      if (arr.length > 0) {
        console.log(`\n=== ${name} расхождения (${arr.length}): ===`);
        arr.forEach((d) => console.log(' ', d));
      } else {
        console.log(`MACD ${name}: все значения совпадают ✓`);
      }
    });

    expect(discrepanciesMacd.length).toBe(0);
    // Signal/Histogram совпадают только если оба используют EMA для signal
    expect(discrepanciesSignal.length).toBe(0);
    expect(discrepanciesHist.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------
describe('calcBB vs technicalindicators.BollingerBands', () => {
  it('BB(20) upper/middle/lower совпадают с точностью 0.01%', () => {
    const mine = calcBB(PRICES, 20);

    // TI BB: первый результат = индекс 19 у mine (period-1)
    const tiResult = ti.BollingerBands.calculate({
      period: 20,
      values: PRICES,
      stdDev: 2,
    });
    const offset = 19;

    const fields: Array<{ name: string; myArr: number[]; tiKey: string }> = [
      { name: 'middle', myArr: mine.middle, tiKey: 'middle' },
      { name: 'upper', myArr: mine.upper, tiKey: 'upper' },
      { name: 'lower', myArr: mine.lower, tiKey: 'lower' },
    ];

    fields.forEach(({ name, myArr, tiKey }) => {
      const discrepancies: string[] = [];

      tiResult.forEach((row, ti_i) => {
        const my_i = ti_i + offset;
        const myVal = myArr[my_i];
        const tiVal = row[tiKey as keyof typeof row] as number;

        if (!near(myVal, tiVal)) {
          discrepancies.push(
            `idx=${my_i}: mine=${myVal?.toFixed(6)} ti=${tiVal?.toFixed(6)} diff=${Math.abs(myVal - tiVal).toFixed(6)}`,
          );
        }
      });

      if (discrepancies.length > 0) {
        console.log(
          `\n=== BB ${name} расхождения (${discrepancies.length}/${tiResult.length}): ===`,
        );
        discrepancies.forEach((d) => console.log(' ', d));
        console.log(
          'NOTE: расхождение в stdDev может быть из-за population vs sample variance.',
        );
      } else {
        console.log(`BB ${name}: все ${tiResult.length} значений совпадают ✓`);
      }

      expect(discrepancies.length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// BB bandwidth — ширина в процентах от middle; эталон — та же формула по
// полосам technicalindicators
// ---------------------------------------------------------------------------
describe('calcBB.bandwidth vs technicalindicators.BollingerBands', () => {
  it('BB(20) bandwidth = (upper - lower) / middle * 100 по полосам эталона', () => {
    const mine = calcBB(PRICES, 20);
    const tiResult = ti.BollingerBands.calculate({
      period: 20,
      values: PRICES,
      stdDev: 2,
    });
    const offset = 19;

    expect(tiResult.length).toBe(PRICES.length - offset);
    const discrepancies = tiResult.filter((row, ti_i) => {
      const expected = ((row.upper - row.lower) / row.middle) * 100;
      return !near(mine.bandwidth[ti_i + offset], expected);
    });

    expect(discrepancies.length).toBe(0);
    expect(mine.bandwidth.slice(0, offset).every(Number.isNaN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SMA
// ---------------------------------------------------------------------------
describe('calcSMA vs technicalindicators.SMA', () => {
  it('SMA(5) — все значения совпадают с точностью 0.01%', () => {
    const mine = calcSMA(PRICES, 5);
    const tiResult = ti.SMA.calculate({ period: 5, values: PRICES });
    const offset = 4;

    expect(tiResult.length).toBe(PRICES.length - offset);
    const discrepancies = tiResult.filter(
      (tiVal, ti_i) => !near(mine[ti_i + offset], tiVal),
    );

    expect(discrepancies.length).toBe(0);
    expect(mine.slice(0, offset).every(Number.isNaN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ADX (TASK-0011): вся дневная история BTCUSDT Binance 2017-08-17…2026-11-02,
// [t, high, low, close] — фикстура curl
// ---------------------------------------------------------------------------
const DAILY = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      'market',
      'fixtures',
      'klines-1d-btc-2026-11-02.json',
    ),
    'utf8',
  ),
) as [number, number, number, number][];

describe('calcADX vs technicalindicators.ADX', () => {
  const high = DAILY.map((k) => k[1]);
  const low = DAILY.map((k) => k[2]);
  const close = DAILY.map((k) => k[3]);
  const FIRST = 2 * 14 - 1;

  it('фикстура — 3365 закрытых дней без дыр', () => {
    expect(DAILY.length).toBe(3365);
    const DAY = 86_400_000;
    expect(
      DAILY.every((k, i) => i === 0 || k[0] - DAILY[i - 1][0] === DAY),
    ).toBe(true);
  });

  it('ADX(14), +DI, −DI — каждая точка истории совпадает с эталоном до 1e-9', () => {
    const mine = calcADX(high, low, close, 14);
    const ref = ti.ADX.calculate({ high, low, close, period: 14 });

    expect(ref.length).toBe(close.length - FIRST);
    const bad: string[] = [];
    ref.forEach((r, j) => {
      const i = j + FIRST;
      (['adx', 'pdi', 'mdi'] as const).forEach((f) => {
        if (!(Math.abs(mine[f][i] - r[f]) <= 1e-9)) {
          bad.push(`${f}[${i}] ${mine[f][i]} ≠ ${r[f]}`);
        }
      });
    });
    expect(bad).toEqual([]);
  });

  it('до индекса 2·14 − 1 все три ряда — NaN, длина = длине входа', () => {
    const mine = calcADX(high, low, close, 14);
    (['adx', 'pdi', 'mdi'] as const).forEach((f) => {
      expect(mine[f].length).toBe(close.length);
      expect(mine[f].slice(0, FIRST).every(Number.isNaN)).toBe(true);
      expect(Number.isNaN(mine[f][FIRST])).toBe(false);
    });
  });

  it('ряд короче 2·14 свечей — весь NaN (эталон пуст)', () => {
    const n = 2 * 14 - 1;
    const mine = calcADX(high.slice(0, n), low.slice(0, n), close.slice(0, n));
    expect(
      ti.ADX.calculate({
        high: high.slice(0, n),
        low: low.slice(0, n),
        close: close.slice(0, n),
        period: 14,
      }).length,
    ).toBe(0);
    (['adx', 'pdi', 'mdi'] as const).forEach((f) => {
      expect(mine[f].length).toBe(n);
      expect(mine[f].every(Number.isNaN)).toBe(true);
    });
  });

  it('равные движения вверх и вниз (+DM = −DM = 0) — как эталон', () => {
    // Каждый третий день максимум растёт ровно на столько, на сколько падает
    // минимум: ни +DM, ни −DM. В истории BTC такого дня нет (мутант «≥» там
    // зелёный) — известный случай на ручном ряде, эталон тот же.
    const h: number[] = [],
      l: number[] = [],
      c: number[] = [];
    let mid = 100;
    for (let i = 0; i < 40; i++) {
      const w = i % 3 === 0 ? 2 + (i % 2) : 1.5;
      mid += i % 3 === 0 ? 0 : i % 2 ? 1.25 : -0.75;
      h.push(mid + w);
      l.push(mid - w);
      c.push(mid + (i % 2 ? 0.5 : -0.5));
    }
    let ties = 0;
    for (let i = 1; i < h.length; i++) {
      if (h[i] - h[i - 1] === l[i - 1] - l[i] && h[i] > h[i - 1]) ties++;
    }
    expect(ties).toBeGreaterThan(3);

    const mine = calcADX(h, l, c, 14);
    const ref = ti.ADX.calculate({ high: h, low: l, close: c, period: 14 });
    expect(ref.length).toBe(h.length - FIRST);
    ref.forEach((r, j) => {
      (['adx', 'pdi', 'mdi'] as const).forEach((f) => {
        expect(Math.abs(mine[f][j + FIRST] - r[f])).toBeLessThanOrEqual(1e-9);
      });
    });
  });
});
