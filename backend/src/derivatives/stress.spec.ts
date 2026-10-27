import { readFileSync } from 'fs';
import { join } from 'path';
import { FundingPayment, Stress } from './derivatives.types';
import { fundingStress } from './stress';

// Оракул — независимый расчёт на Python (scratchpad TASK-0007.3, oracle.py)
// по срезам реальной истории fundingRate Binance (выгрузка TASK-0007.1).
interface Oracle {
  series: Record<string, [number, string][]>;
  cases: {
    name: string;
    series: string;
    rate: number;
    nextFundingTime: number;
    now: number;
    expected: Stress | null;
  }[];
}
const ORACLE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stress-oracle.json'), 'utf8'),
) as Oracle;

const history = (key: string): FundingPayment[] =>
  ORACLE.series[key].map(([t, rate]) => ({ t, rate: Number(rate) }));

describe('fundingStress против независимого расчёта', () => {
  it.each(ORACLE.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const got = fundingStress(
      history(c.series),
      c.rate,
      c.nextFundingTime,
      c.now,
    );
    if (c.expected === null) {
      expect(got).toBeNull();
      return;
    }
    expect(got).not.toBeNull();
    const { tailPct, ...rest } = c.expected;
    expect(got).toMatchObject(rest);
    if (tailPct === null) expect(got!.tailPct).toBeNull();
    else expect(got!.tailPct).toBeCloseTo(tailPct, 9);
  });

  it('эталон покрывает все состояния', () => {
    const states = new Set(ORACLE.cases.map((c) => c.expected?.state));
    expect([...states].sort()).toEqual(
      ['above', 'below', 'negative', 'neutral', 'unknown'].sort(),
    );
  });
});

describe('fundingStress — края', () => {
  const H8 = 8 * 3_600_000;
  const T0 = Date.UTC(2025, 0, 1);
  const flat = (n: number, rate: number): FundingPayment[] =>
    Array.from({ length: n }, (_, i) => ({ t: T0 + i * H8, rate }));

  it('пустая история и одна выплата (без шага) → null', () => {
    expect(fundingStress([], 0.0001, T0 + H8, T0)).toBeNull();
    expect(fundingStress(flat(1, 0.0001), 0.0001, T0 + H8, T0)).toBeNull();
  });

  it('выплаты после now не учитываются (нет заглядывания вперёд)', () => {
    const h = [...flat(10, 0.00005), { t: T0 + 10 * H8, rate: -1 }];
    const got = fundingStress(h, 0.00005, T0 + 10 * H8, T0 + 9 * H8 + 1);
    // 10 выплат ≤ now, первая без шага — 9 в окне
    expect(got).toMatchObject({ samples: 9, state: 'below', tailPct: 100 });
  });

  it('окно 365 дней: выплата ровно на левой границе не входит', () => {
    const h = flat(1100, 0.00005);
    const now = h[1099].t;
    const got = fundingStress(h, 0.00005, now + H8, now);
    // (now − 365 дн, now] — ровно 1095 выплат с шагом 8 ч
    expect(got!.samples).toBe(1095);
  });

  it('дрожание на мс в обе стороны — всё ещё 8 ч', () => {
    const h = [
      { t: T0, rate: 0.00005 },
      { t: T0 + H8 + 5, rate: 0.00005 },
      { t: T0 + 2 * H8 - 8, rate: 0.00005 },
    ];
    // шаги 8 ч + 5 мс и 8 ч − 13 мс — оба в окне; до следующей 8 ч − 8 мс
    expect(
      fundingStress(h, 0.00005, T0 + 3 * H8 - 16, T0 + 2 * H8),
    ).toMatchObject({
      intervalHours: 8,
      samples: 2,
      state: 'below',
    });
  });

  it('текущий интервал — по nextFundingTime: смена 8 → 4 ч видна сразу', () => {
    const h = flat(10, 0.00005);
    const last = h[9].t;
    expect(
      fundingStress(h, 0.0001, last + 4 * 3_600_000, last + 1)!.state,
    ).toBe('unknown');
  });

  it('выплаты с шагом не 8 ч в окно не входят', () => {
    const H2 = 2 * 3_600_000;
    const short = Array.from({ length: 5 }, (_, i) => ({
      t: T0 + 9 * H8 + (i + 1) * H2,
      rate: -0.02,
    }));
    const back = { t: short[4].t + H8, rate: 0.00005 };
    const h = [...flat(10, 0.00005), ...short, back];
    // 9 выплат 8 ч из flat + back; пять по 2 ч — нет
    const got = fundingStress(h, -0.001, back.t + H8, back.t);
    expect(got).toMatchObject({ samples: 10, state: 'negative', tailPct: 0 });
  });
});
