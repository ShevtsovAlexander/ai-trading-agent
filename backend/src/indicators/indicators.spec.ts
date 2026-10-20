/**
 * Сравнение calcEMA / calcRSI / calcMACD / calcBB / calcSMA из indicators.ts
 * с библиотекой technicalindicators на одних и тех же ценах.
 *
 * Запуск: npm run test -- indicators
 */

import * as ti from 'technicalindicators';
import { calcBB, calcEMA, calcMACD, calcRSI, calcSMA } from './indicators';

// ---------------------------------------------------------------------------
// Детерминированные тестовые цены (50 значений) — синусоида + линейный тренд
// ---------------------------------------------------------------------------
const PRICES = Array.from(
  { length: 50 },
  (_, i) => parseFloat((100 + i * 0.5 + Math.sin(i * 0.4) * 8).toFixed(6)),
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
        console.log(`\n=== EMA(${period}) расхождения (${discrepancies.length}/${tiResult.length}): ===`);
        discrepancies.slice(0, 10).forEach((d) => console.log(' ', d));
      } else {
        console.log(`EMA(${period}): все ${tiResult.length} значений совпадают ✓`);
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
      console.log(`\n=== RSI(14) расхождения (${discrepancies.length}/${tiResult.length}): ===`);
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
    { name: 'монотонный рост', values: Array.from({ length: 20 }, (_, i) => 100 + i) },
    { name: 'монотонное падение', values: Array.from({ length: 20 }, (_, i) => 100 - i) },
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

    [
      ['MACD line', discrepanciesMacd],
      ['Signal', discrepanciesSignal],
      ['Histogram', discrepanciesHist],
    ].forEach(([name, diffs]) => {
      const arr = diffs as string[];
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
      { name: 'upper',  myArr: mine.upper,  tiKey: 'upper'  },
      { name: 'lower',  myArr: mine.lower,  tiKey: 'lower'  },
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
        console.log(`\n=== BB ${name} расхождения (${discrepancies.length}/${tiResult.length}): ===`);
        discrepancies.forEach((d) => console.log(' ', d));
        console.log('NOTE: расхождение в stdDev может быть из-за population vs sample variance.');
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
