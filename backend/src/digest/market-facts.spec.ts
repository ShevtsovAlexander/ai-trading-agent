/**
 * Факты рынка для свода (TASK-0012): разбор и расчёт на реальных klines 1h
 * Binance трёх монет (фикстура curl 2026-11-03) против эталона скрипта Python
 * (fixtures/hourly-2026-11-03.json → oracle).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import {
  HOURS,
  WINDOW_MS,
  buildFact,
  factLine,
  fetchHourly,
  parseHourly,
} from './market-facts';

const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'hourly-2026-11-03.json'), 'utf8'),
) as {
  now: number;
  startTime: number;
  rows: Record<string, unknown[][]>;
  oracle: Record<
    string,
    {
      price: number;
      changeRaw: number;
      ratioRaw: number;
      volume24hUsd: number;
      at: number;
      hours: number;
      dropped: number;
    }
  >;
};
const COINS = [
  ['bitcoin', 'BTCUSDT', 'BTC/USDT'],
  ['ethereum', 'ETHUSDT', 'ETH/USDT'],
  ['solana', 'SOLUSDT', 'SOL/USDT'],
] as const;

describe('market-facts — эталон Python на реальных klines 1h', () => {
  COINS.forEach(([coinId, symbol, market]) => {
    it(`${symbol}: цена, Δ24ч, объём, отношение к 30 дн., время = эталону`, () => {
      const o = FX.oracle[symbol];
      const hours = parseHourly(FX.rows[symbol], FX.now);
      expect(FX.rows[symbol].length - hours.length).toBe(o.dropped); // незакрытый час
      expect(hours.length).toBeGreaterThanOrEqual(HOURS);
      const f = buildFact(coinId, market, hours, { regime: 'range', days: 3 });
      expect(f.price).toBe(o.price);
      expect(Math.abs(f.change24hPct - o.changeRaw)).toBeLessThanOrEqual(
        0.005 + 1e-12,
      );
      expect(Math.abs(f.volumeRatio30d - o.ratioRaw)).toBeLessThanOrEqual(
        0.005 + 1e-12,
      );
      expect(
        Math.abs(f.volume24hUsd - o.volume24hUsd) / o.volume24hUsd,
      ).toBeLessThanOrEqual(1e-9);
      expect(f.at).toBe(o.at);
      expect(f).toMatchObject({
        coinId,
        market,
        regime: 'range',
        regimeDays: 3,
      });
    });
  });

  it('BTC: строка промпта — числа в русском формате, режим словами', () => {
    const f = buildFact(
      'bitcoin',
      'BTC/USDT',
      parseHourly(FX.rows.BTCUSDT, FX.now),
      { regime: 'range', days: 17 },
    );
    expect(factLine(f)).toBe(
      'BTC: цена 77 732,00 USDT; за 24 ч +0,30 %; объём за 24 ч 1,08 млрд USDT — 0,96 от среднего суточного за 30 дней; режим по дневным свечам: боковик, 17 дн.',
    );
    expect(
      factLine({ ...f, regime: null, regimeDays: null, change24hPct: -1.5 }),
    ).toContain('за 24 ч -1,50 %; ');
    expect(factLine({ ...f, regime: null, regimeDays: null })).toContain(
      'режим по дневным свечам: нет данных',
    );
  });
});

describe('market-facts — края и порча', () => {
  const rows = FX.rows.BTCUSDT;

  it('меньше 744 закрытых часов — ошибка, а не среднее по неполной базе', () => {
    const hours = parseHourly(rows, FX.now).slice(-(HOURS - 1));
    expect(hours.length).toBe(HOURS - 1);
    expect(() => buildFact('bitcoin', 'BTC/USDT', hours, null)).toThrow(
      'мало часовых свечей: 743 из 744',
    );
  });

  it('больше 744 — берутся последние 744', () => {
    const extra = parseHourly(rows, FX.now);
    const pre = {
      ...extra[0],
      t: extra[0].t - 3_600_000,
      closeTime: extra[0].closeTime - 3_600_000,
      quoteVolume: 1e15,
    };
    const f = buildFact('bitcoin', 'BTC/USDT', [pre, ...extra], null);
    expect(f.volumeRatio30d).toBe(
      buildFact('bitcoin', 'BTC/USDT', extra, null).volumeRatio30d,
    );
  });

  it('известный ответ: база — ровно 720 часов перед последними 24, цена — к часу 24 ч назад', () => {
    // Первый час базы весит 720, остальные базовые — по 1, последние 24 — по 1:
    // база = (720 + 719) / 30 = 47,97; объём 24 ч = 24 → 0,50. Потеря первого
    // часа базы дала бы 1,00. Цена: close часа 24 ч назад = 100, последний = 110.
    const H = 3_600_000;
    const hours = Array.from({ length: HOURS }, (_, i) => ({
      t: i * H,
      closeTime: (i + 1) * H - 1,
      close: i === HOURS - 25 ? 100 : i === HOURS - 1 ? 110 : 50,
      quoteVolume: i === 0 ? 720 : 1,
    }));
    const f = buildFact('bitcoin', 'BTC/USDT', hours, null);
    expect(f.volume24hUsd).toBe(24);
    expect(f.volumeRatio30d).toBe(0.5);
    expect(f.change24hPct).toBe(10);
    expect(f.price).toBe(110);
    expect(f.at).toBe(HOURS * H - 1);
  });

  it('порча строки — ошибка с именем поля', () => {
    const bad = (i: number, v: unknown) => {
      const r = [...rows[0]];
      r[i] = v;
      return [r];
    };
    expect(() => parseHourly({}, FX.now)).toThrow('ответ не массив');
    expect(() => parseHourly([rows[0].slice(0, 7)], FX.now)).toThrow(
      '8+ полей',
    );
    expect(() => parseHourly(bad(7, 'abc'), FX.now)).toThrow(
      'quoteAssetVolume',
    );
    expect(() => parseHourly(bad(7, ''), FX.now)).toThrow('quoteAssetVolume');
    expect(() => parseHourly(bad(7, '-1'), FX.now)).toThrow('quoteAssetVolume');
    expect(() => parseHourly(bad(4, null), FX.now)).toThrow('close');
    expect(() => parseHourly(bad(6, '123'), FX.now)).toThrow('closeTime');
    expect(() => parseHourly(bad(0, 1.5), FX.now)).toThrow('openTime');
  });

  it('фикстура снята ровно параметрами кода: startTime = now − 32 сут., первая свеча не раньше', () => {
    // Иначе фикстура прячет нехватку часов (критик T1–T3: окно 31 сутки давало 743)
    expect(FX.startTime).toBe(FX.now - WINDOW_MS);
    for (const [, symbol] of COINS) {
      expect(FX.rows[symbol][0][0] as number).toBeGreaterThanOrEqual(
        FX.startTime,
      );
      expect(FX.rows[symbol].length).toBeLessThan(1000);
    }
  });

  it('в любую минуту часа окно даёт ≥ 744 закрытых часа (сетка часов, как Binance)', () => {
    const H = 3_600_000;
    const hour0 = Math.floor(FX.now / H) * H;
    for (const m of [0, 1, 30 * 60_000, H - 1]) {
      const now = hour0 + m;
      const start = now - WINDOW_MS; // окно кода, не константа теста
      // Binance: openTime ≥ startTime, ≤ endTime, по сетке часа
      const firstOpen = Math.ceil(start / H) * H;
      const closed = (hour0 - firstOpen) / H; // часы firstOpen … hour0 − 1 ч закрыты
      expect(closed).toBeGreaterThanOrEqual(HOURS);
    }
  });

  it('запрос — klines 1h, окно 32 сутки до now, limit 1000; ответ разобран', async () => {
    const calls: { url: string; params: Record<string, unknown> }[] = [];
    const http = {
      get: (url: string, { params }: { params: Record<string, unknown> }) => {
        calls.push({ url, params });
        return of({ data: rows });
      },
    } as unknown as HttpService;
    const hours = await fetchHourly(http, 'BTCUSDT', FX.now);
    expect(calls).toEqual([
      {
        url: 'https://api.binance.com/api/v3/klines',
        params: {
          symbol: 'BTCUSDT',
          interval: '1h',
          startTime: FX.now - 32 * 24 * 3_600_000,
          endTime: FX.now,
          limit: 1000,
        },
      },
    ]);
    expect(hours).toEqual(parseHourly(rows, FX.now));
  });
});
