import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import {
  fetchFunding,
  fetchFundingHistory,
  fetchOpenInterestBinance,
  fetchOpenInterestBybit,
  fetchOpenInterestOkx,
} from './sources';

// Реальные ответы бирж (curl 2026-10-27) — оракул разбора: числа сверяются
// с полями ответа, а не с тем, что выдаёт код.
type Raw = Record<string, any>;
interface Live {
  binancePremiumIndex: Record<string, Raw>;
  binanceOpenInterest: Record<string, Raw>;
  okxOpenInterest: Record<string, Raw>;
  bybitTickers: Record<string, Raw>;
  errors: { okx: Raw; bybit: Raw };
}
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   поля фикстуры — сырой JSON бирж, форма проверяется самим тестом */
const LIVE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'live-2026-10-27.json'), 'utf8'),
) as Live;

// Фейк отдаёт заданное тело на любой URL и запоминает запросы
const replying = (data: unknown) => {
  const calls: { url: string; params: Record<string, unknown> }[] = [];
  const http = {
    get: (url: string, { params }: { params: Record<string, unknown> }) => {
      calls.push({ url, params });
      return of({ data, headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls };
};

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const OKX_IDS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'];

describe('fetchFunding', () => {
  it.each(SYMBOLS)('%s: поля premiumIndex как в ответе', async (symbol) => {
    const raw = LIVE.binancePremiumIndex[symbol];
    const { http, calls } = replying(raw);
    expect(await fetchFunding(http, symbol)).toEqual({
      rate: Number(raw.lastFundingRate),
      nextFundingTime: raw.nextFundingTime,
      markPrice: Number(raw.markPrice),
      at: raw.time,
    });
    expect(calls[0].params).toEqual({ symbol });
  });

  it('ставка — строка-не-число → ошибка, не NaN', async () => {
    const raw = { ...LIVE.binancePremiumIndex.BTCUSDT, lastFundingRate: 'abc' };
    await expect(fetchFunding(replying(raw).http, 'BTCUSDT')).rejects.toThrow(
      /lastFundingRate/,
    );
  });

  it('нет nextFundingTime → ошибка', async () => {
    const raw = { ...LIVE.binancePremiumIndex.BTCUSDT };
    delete raw.nextFundingTime;
    await expect(fetchFunding(replying(raw).http, 'BTCUSDT')).rejects.toThrow(
      /nextFundingTime/,
    );
  });
});

describe('строгость разбора (критик T2)', () => {
  it.each(['  ', '\n'])(
    'пробельная строка %j в ставке → ошибка, не 0',
    async (blank) => {
      const raw = {
        ...LIVE.binancePremiumIndex.BTCUSDT,
        lastFundingRate: blank,
      };
      await expect(fetchFunding(replying(raw).http, 'BTCUSDT')).rejects.toThrow(
        /lastFundingRate/,
      );
    },
  );

  it('markPrice 0 → ошибка', async () => {
    const raw = { ...LIVE.binancePremiumIndex.BTCUSDT, markPrice: '0' };
    await expect(fetchFunding(replying(raw).http, 'BTCUSDT')).rejects.toThrow(
      /markPrice/,
    );
  });

  it('отрицательный OI Binance → ошибка', async () => {
    const raw = { ...LIVE.binanceOpenInterest.BTCUSDT, openInterest: '-1' };
    await expect(
      fetchOpenInterestBinance(replying(raw).http, 'BTCUSDT', 79893.7),
    ).rejects.toThrow(/openInterest/);
  });

  it('OI Binance при markPrice ≤ 0 → ошибка', async () => {
    await expect(
      fetchOpenInterestBinance(
        replying(LIVE.binanceOpenInterest.BTCUSDT).http,
        'BTCUSDT',
        0,
      ),
    ).rejects.toThrow(/markPrice/);
  });

  it('отрицательный oiUsd OKX → ошибка', async () => {
    const raw = structuredClone(LIVE.okxOpenInterest['BTC-USDT-SWAP']);
    raw.data[0].oiUsd = '-5';
    await expect(
      fetchOpenInterestOkx(replying(raw).http, 'BTC-USDT-SWAP'),
    ).rejects.toThrow(/oiUsd/);
  });

  it('отрицательный openInterestValue Bybit → ошибка', async () => {
    const raw = structuredClone(LIVE.bybitTickers.BTCUSDT);
    raw.result.list[0].openInterestValue = '-5';
    await expect(
      fetchOpenInterestBybit(replying(raw).http, 'BTCUSDT'),
    ).rejects.toThrow(/openInterestValue/);
  });

  it('OI ровно 0 допустим (пустой рынок — не ошибка)', async () => {
    const raw = structuredClone(LIVE.bybitTickers.BTCUSDT);
    raw.result.list[0].openInterestValue = '0';
    expect(
      (await fetchOpenInterestBybit(replying(raw).http, 'BTCUSDT')).usd,
    ).toBe(0);
  });
});

describe('fetchOpenInterestBinance', () => {
  it.each(SYMBOLS)('%s: монеты × markPrice, не монеты', async (symbol) => {
    const oi = LIVE.binanceOpenInterest[symbol];
    const mark = Number(LIVE.binancePremiumIndex[symbol].markPrice);
    const result = await fetchOpenInterestBinance(
      replying(oi).http,
      symbol,
      mark,
    );
    expect(result).toEqual({
      usd: Number(oi.openInterest) * mark,
      at: oi.time,
    });
  });

  it('BTC: ≈ 7,84 млрд USD (98 147 BTC × 79 894), а не 98 147', async () => {
    const result = await fetchOpenInterestBinance(
      replying(LIVE.binanceOpenInterest.BTCUSDT).http,
      'BTCUSDT',
      Number(LIVE.binancePremiumIndex.BTCUSDT.markPrice),
    );
    expect(result.usd).toBeCloseTo(98147.175 * 79893.71833333, 0);
    expect(result.usd).toBeGreaterThan(7.8e9);
    expect(result.usd).toBeLessThan(7.9e9);
  });
});

describe('fetchOpenInterestOkx', () => {
  it.each(OKX_IDS)('%s: oiUsd и ts из ответа', async (instId) => {
    const raw = LIVE.okxOpenInterest[instId];
    const { http, calls } = replying(raw);
    expect(await fetchOpenInterestOkx(http, instId)).toEqual({
      usd: Number(raw.data[0].oiUsd),
      at: Number(raw.data[0].ts),
    });
    expect(calls[0].params).toEqual({ instType: 'SWAP', instId });
  });

  it('ошибка OKX в теле при HTTP 200 (code 51001) → ошибка с текстом биржи', async () => {
    await expect(
      fetchOpenInterestOkx(replying(LIVE.errors.okx).http, 'XXX-USDT-SWAP'),
    ).rejects.toThrow(/51001.*doesn't exist/);
  });

  it('нет oiUsd → ошибка', async () => {
    const raw = structuredClone(LIVE.okxOpenInterest['BTC-USDT-SWAP']);
    delete raw.data[0].oiUsd;
    await expect(
      fetchOpenInterestOkx(replying(raw).http, 'BTC-USDT-SWAP'),
    ).rejects.toThrow(/oiUsd/);
  });
});

describe('fetchOpenInterestBybit', () => {
  it.each(SYMBOLS)('%s: openInterestValue и time ответа', async (symbol) => {
    const raw = LIVE.bybitTickers[symbol];
    const { http, calls } = replying(raw);
    expect(await fetchOpenInterestBybit(http, symbol)).toEqual({
      usd: Number(raw.result.list[0].openInterestValue),
      at: raw.time,
    });
    expect(calls[0].params).toEqual({ category: 'linear', symbol });
  });

  it('ошибка Bybit в теле при HTTP 200 (retCode 10001) → ошибка', async () => {
    await expect(
      fetchOpenInterestBybit(replying(LIVE.errors.bybit).http, 'XXXUSDT'),
    ).rejects.toThrow(/10001.*symbol invalid/);
  });

  it('пустое openInterestValue → ошибка, не 0', async () => {
    const raw = structuredClone(LIVE.bybitTickers.BTCUSDT);
    raw.result.list[0].openInterestValue = '';
    await expect(
      fetchOpenInterestBybit(replying(raw).http, 'BTCUSDT'),
    ).rejects.toThrow(/openInterestValue/);
  });
});

// История — фейк применяет startTime/endTime/limit как Binance (фильтр по
// fundingTime включительно, по возрастанию, не больше limit). Ответ Binance
// без startTime (500 последних, замер T1) фейк не воспроизводит: код всегда
// шлёт startTime > 0, вызов без него отсекается до запроса (тест ниже). Фейк, отдающий всё подряд, сделал бы
// тест пагинации false-green (klines.spec.ts).
const H0 = Date.UTC(2024, 0, 1);
const H_STEP = 8 * 3600_000;
const H_TOTAL = 2300;
const H_ROWS = Array.from({ length: H_TOTAL }, (_, i) => ({
  symbol: 'BTCUSDT',
  fundingTime: H0 + i * H_STEP,
  fundingRate: (i * 1e-8).toFixed(8),
  markPrice: '1',
}));

const historyHttp = ({ ignoreStartTime = false } = {}) => {
  const calls: Record<string, number>[] = [];
  const http = {
    get: (_url: string, { params }: { params: Record<string, number> }) => {
      calls.push(params);
      const limit = params.limit ?? 100;
      const rows = H_ROWS.filter(
        (r) =>
          (ignoreStartTime ||
            params.startTime === undefined ||
            r.fundingTime >= params.startTime) &&
          (params.endTime === undefined || r.fundingTime <= params.endTime),
      );
      return of({ data: rows.slice(0, limit), headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls };
};

describe('fetchFundingHistory', () => {
  it('2300 выплат за 3 страницы: по возрастанию, шаг 8 ч, без дублей на стыках', async () => {
    const { http, calls } = historyHttp();
    const rows = await fetchFundingHistory(
      http,
      'BTCUSDT',
      H0,
      H0 + (H_TOTAL - 1) * H_STEP,
    );
    expect(rows).toHaveLength(H_TOTAL);
    expect(calls).toHaveLength(3);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].t - rows[i - 1].t).toBe(H_STEP);
    }
    // содержимое — та же выплата, что в ряду
    expect(rows[1500]).toEqual({ t: H0 + 1500 * H_STEP, rate: 1500e-8 });
    // страницы со сдвигом от последней выплаты + 1
    expect(calls[1].startTime).toBe(H0 + 999 * H_STEP + 1);
    expect(calls.every((c) => c.limit === 1000)).toBe(true);
  });

  it('окно внутри ряда: только выплаты из [startTime, endTime]', async () => {
    const { http } = historyHttp();
    const rows = await fetchFundingHistory(
      http,
      'BTCUSDT',
      H0 + 10 * H_STEP,
      H0 + 19 * H_STEP,
    );
    expect(rows.map((r) => r.t)).toEqual(
      Array.from({ length: 10 }, (_, i) => H0 + (10 + i) * H_STEP),
    );
  });

  it('startTime 0 → ошибка без запроса (Binance отдал бы 500 последних)', async () => {
    const { http, calls } = historyHttp();
    await expect(
      fetchFundingHistory(http, 'BTCUSDT', 0, H0 + H_STEP),
    ).rejects.toThrow(/startTime/);
    expect(calls).toHaveLength(0);
  });

  it('страница не сдвинулась — ошибка, а не бесконечный цикл', async () => {
    const { http, calls } = historyHttp({ ignoreStartTime: true });
    // окно начинается правее первой страницы: ответ «с начала ряда» не сдвигает from
    await expect(
      fetchFundingHistory(
        http,
        'BTCUSDT',
        H0 + 1200 * H_STEP,
        H0 + 2299 * H_STEP,
      ),
    ).rejects.toThrow(/не сдвинулась/);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('битая ставка в истории → ошибка', async () => {
    const { http } = replying([{ fundingTime: H0, fundingRate: 'x' }]);
    await expect(fetchFundingHistory(http, 'BTCUSDT', H0, H0)).rejects.toThrow(
      /fundingRate/,
    );
  });
});
