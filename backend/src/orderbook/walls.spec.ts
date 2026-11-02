import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import {
  BUCKET_STEP,
  Book,
  ORDERBOOK_SYMBOLS,
  WALLS_PER_SIDE,
} from './orderbook.types';
import { fetchBookOkx, fetchDepthBinance } from './sources';
import { Wall, buildWalls } from './walls';

// Оракул — эталон независимого скрипта Python (Decimal) на тех же сырых
// ответах фикстуры (поле expected, tasklist TASK-0009.2). Стаканы
// разбираются кодом T1 — его разбор сверен с сырыми полями в sources.spec.
interface ExpectedWall {
  from: number;
  to: number;
  coin: number;
  usdt: number;
  byExchange: Record<string, number>;
}
interface Expected {
  mid: number;
  coverage: { bid: number; ask: number };
  bids: ExpectedWall[];
  asks: ExpectedWall[];
  bidsNextMax: number | null;
  asksNextMax: number | null;
}

const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'books-2026-11-02.json'), 'utf8'),
) as {
  binance: Record<string, unknown>;
  okx: Record<string, unknown>;
  expected: Record<string, Expected>;
};

const replying = (data: unknown) =>
  ({ get: () => of({ data, headers: {} }) }) as unknown as HttpService;

const COINS = ['bitcoin', 'ethereum', 'solana'];
const CASES = ['both', 'binance', 'okx'] as const;

const books = async (coin: string) => {
  const s = ORDERBOOK_SYMBOLS[coin];
  return {
    binance: await fetchDepthBinance(
      replying(FX.binance[s.binance]),
      s.binance,
      () => 1,
    ),
    okx: await fetchBookOkx(replying(FX.okx[s.okx]), s.okx),
  };
};

const input = (
  b: { binance: Book; okx: Book },
  coin: string,
  c: (typeof CASES)[number],
) => ({
  binance: c === 'okx' ? null : b.binance,
  okx: c === 'binance' ? null : b.okx,
  step: BUCKET_STEP[coin],
  n: WALLS_PER_SIDE,
});

// Относительная точность 1e-9: сумма float против Decimal
const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(expected)),
  );

const sameWalls = (actual: Wall[], expected: ExpectedWall[]) => {
  expect(actual.map((w) => w.from)).toEqual(expected.map((w) => w.from));
  actual.forEach((w, i) => {
    const e = expected[i];
    expect(w.to).toBe(e.to);
    close(w.coin, e.coin);
    close(w.usdt, e.usdt);
    expect(Object.keys(w.byExchange).sort()).toEqual(Object.keys(e.byExchange));
    for (const [ex, v] of Object.entries(e.byExchange)) {
      close(w.byExchange[ex as 'binance' | 'okx']!, v);
    }
  });
};

describe.each(COINS)('buildWalls %s', (coin) => {
  it.each(CASES)(
    '%s: совпадает с эталоном по всем ступеням и полям',
    async (c) => {
      const exp = FX.expected[`${coin}|${c}`];
      const r = buildWalls(input(await books(coin), coin, c));
      close(r.mid, exp.mid);
      expect(r.coverage).toEqual(exp.coverage);
      expect(r.bids).toHaveLength(WALLS_PER_SIDE);
      expect(r.asks).toHaveLength(WALLS_PER_SIDE);
      sameWalls(r.bids, exp.bids);
      sameWalls(r.asks, exp.asks);
    },
  );

  it.each(CASES)(
    '%s: стороны от mid, не дальше края, топ-N честный',
    async (c) => {
      const exp = FX.expected[`${coin}|${c}`];
      const r = buildWalls(input(await books(coin), coin, c));
      // Полоса не заходит за цену: ступень с mid внутри обрезана (критик T2)
      for (const w of r.bids) {
        expect(w.to).toBeLessThanOrEqual(r.mid);
        expect(w.from).toBeGreaterThanOrEqual(r.coverage.bid);
      }
      for (const w of r.asks) {
        expect(w.from).toBeGreaterThanOrEqual(r.mid);
        expect(w.to).toBeLessThanOrEqual(r.coverage.ask);
      }
      // Вне топ-N нет ступени крупнее последней вошедшей (критерий 2 PRD):
      // первая не вошедшая по эталону не больше последней вошедшей
      if (exp.bidsNextMax !== null) {
        expect(r.bids.at(-1)!.usdt).toBeGreaterThanOrEqual(exp.bidsNextMax);
      }
      if (exp.asksNextMax !== null) {
        expect(r.asks.at(-1)!.usdt).toBeGreaterThanOrEqual(exp.asksNextMax);
      }
    },
  );
});

describe('buildWalls: края', () => {
  it('нет ни одного стакана — ошибка', () => {
    expect(() =>
      buildWalls({ binance: null, okx: null, step: 10, n: 10 }),
    ).toThrow(/нет ни одного стакана/);
  });

  it('биржа без заявок в ступени — нет её ключа', async () => {
    const r = buildWalls(input(await books('bitcoin'), 'bitcoin', 'binance'));
    for (const w of [...r.bids, ...r.asks]) {
      expect(Object.keys(w.byExchange)).toEqual(['binance']);
    }
  });
});

// Известный ответ на малых стаканах: правила, которые на реальном снимке не
// меняют топ-10 (мутанты «без деления по mid», «без отброса разрезанной
// ступени», «при равенстве — дальше от цены» были зелёными на фикстуре)
const bookOf = (
  bids: [number, number][],
  asks: [number, number][],
  full = { bid: false, ask: false },
): Book => ({ bids, asks, full, at: 1 });

describe('buildWalls: известный ответ', () => {
  it('продажа OKX ниже mid Binance не попадает в продажи', () => {
    // mid Binance = 100.5; у OKX крупная продажа на 100.2 — ниже mid
    const r = buildWalls({
      // Уровни на 105 — край продаж дальше проверяемой ступени [101, 102)
      binance: bookOf(
        [[100, 1]],
        [
          [101, 1],
          [105, 1],
        ],
        { bid: true, ask: true },
      ),
      okx: bookOf(
        [[99, 1]],
        [
          [100.2, 50],
          [105, 1],
        ],
        { bid: true, ask: true },
      ),
      step: 1,
      n: 10,
    });
    expect(r.mid).toBe(100.5);
    expect(r.asks.map((w) => [w.from, w.coin])).toEqual([[101, 1]]);
    // По usdt: 100 × 1 = 100 > 99 × 1 = 99
    expect(r.bids.map((w) => [w.from, w.coin])).toEqual([
      [100, 1],
      [99, 1],
    ]);
  });

  it('ступень, которую край режет пополам, отброшена', () => {
    // Край покупок — 90.5 (сторона не целая): ступень [90, 100) видна
    // биржей только от 90.5, её 100 монет на 90.5 — неполная ступень
    const r = buildWalls({
      binance: bookOf(
        [
          [100, 1],
          [95, 1],
          [90.5, 100],
        ],
        [
          [101, 1],
          [130, 1],
        ],
      ),
      okx: null,
      step: 10,
      n: 10,
    });
    expect(r.coverage).toEqual({ bid: 90.5, ask: 130 });
    expect(r.bids.map((w) => w.from)).toEqual([100]);
    // Продажи: [100, 110) с 101 цела и обрезана по mid 100.5 → [100.5, 110);
    // [130, 140) режется краем 130
    expect(r.asks.map((w) => [w.from, w.to])).toEqual([[100.5, 110]]);
  });

  it('при равном usdt выигрывает ступень ближе к цене', () => {
    // Покупки: 100 × 1 = 50 × 2 = 100 USDT; продажи: 120 × 1 = 240 × 0.5
    const r = buildWalls({
      binance: bookOf(
        [
          [100, 1],
          [50, 2],
        ],
        [
          [120, 1],
          [240, 0.5],
        ],
        { bid: true, ask: true },
      ),
      okx: null,
      step: 10,
      n: 1,
    });
    expect(r.bids.map((w) => w.from)).toEqual([100]);
    expect(r.asks.map((w) => w.from)).toEqual([120]);
  });
  it('ступень с ценой внутри обрезана по mid; покупка OKX выше mid не учтена', () => {
    // mid Binance = 100.5, ступень 1: [100, 101) делится ценой. Покупка OKX
    // 100.55 > mid — не покупка для графика Binance (критик T2: фильтр
    // покупок по mid не был покрыт ни одним тестом)
    const r = buildWalls({
      binance: bookOf(
        [
          [100.4, 1],
          [98, 1],
        ],
        [
          [100.6, 1],
          [103, 1],
        ],
        { bid: true, ask: true },
      ),
      okx: bookOf(
        [
          [100.55, 50],
          [98, 1],
        ],
        [
          [100.7, 1],
          [103, 1],
        ],
        { bid: true, ask: true },
      ),
      step: 1,
      n: 10,
    });
    // Покупки: [98, 99) — 98 × 2 = 196 USDT; [100, 100.5) — 100.4 × 1
    expect(r.bids.map((w) => [w.from, w.to, w.coin])).toEqual([
      [98, 99, 2],
      [100, 100.5, 1],
    ]);
    // Продажи: [100.5, 101) — 100.6 и 100.7; [103, 104) режется краем 103
    expect(r.asks.map((w) => [w.from, w.to, w.coin])).toEqual([
      [100.5, 101, 2],
    ]);
  });
});
