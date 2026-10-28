import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import {
  fetchFunding,
  fetchFundingHistory,
  fetchMarkBybit,
  fetchOiHistoryBinance,
  fetchOiHistoryBybit,
  fetchOiHistoryOkx,
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

// --- История OI (TASK-0008.1) ---
// Реальные ответы BTC (снимок 2026-10-28, все страницы) — оракул разбора:
// ожидание строится из полей фикстуры, а не из кода. Фейки честно применяют
// endTime / end / cursor / limit, как биржи (стыки — research TASK-0008).
interface OiLive {
  capturedAt: number;
  binance: Record<'1d' | '1h', Raw[]>; // по возрастанию, как Binance
  okx: Record<'1Dutc' | '1H', string[][]>; // новые первыми, как OKX
  bybit: Record<'1d' | '1h', Raw[]>; // новые первыми, как Bybit
  bybitMark: Record<'D' | '60', string[][]>;
  errors: Record<
    'binanceSymbol' | 'binanceStartTime' | 'okx' | 'bybit' | 'bybitMark',
    unknown
  >;
}
const OI = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'oi-history-2026-10-28.json'),
    'utf8',
  ),
) as OiLive;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Окно сервиса: 30 дней и шаг запаса
const fromFor = (step: number) => OI.capturedAt - 30 * DAY - step;

type Call = { url: string; params: Record<string, any> };
const recording = (reply: (params: Record<string, any>) => unknown) => {
  const calls: Call[] = [];
  const http = {
    get: (url: string, { params }: { params: Record<string, any> }) => {
      calls.push({ url, params });
      return of({ data: reply(params), headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls };
};

// Binance: последние limit строк с timestamp ≤ endTime (включительно)
const binanceFake = (rows: Raw[]) =>
  recording((p) => {
    const upTo = rows.filter(
      (r) => p.endTime === undefined || r.timestamp <= p.endTime,
    );
    return upTo.slice(Math.max(0, upTo.length - p.limit));
  });
// OKX: первые limit строк (новые первыми) с ts < end (исключительно)
const okxFake = (rows: string[][]) =>
  recording((p) => ({
    code: '0',
    msg: '',
    data: rows
      .filter((r) => p.end === undefined || Number(r[0]) < p.end)
      .slice(0, p.limit),
  }));
// Bybit: курсор — смещение в списке (новые первыми)
const bybitFake = (rows: Raw[]) =>
  recording((p) => {
    const at = p.cursor === undefined ? 0 : Number(p.cursor);
    const list = rows.slice(at, at + p.limit);
    const more = at + p.limit < rows.length;
    return {
      retCode: 0,
      retMsg: 'OK',
      result: { list, nextPageCursor: more ? String(at + p.limit) : '' },
    };
  });

describe('fetchOiHistoryBinance', () => {
  it.each([
    ['1d', DAY, 30, 1],
    ['1h', HOUR, 720, 2],
  ] as const)(
    '%s: строки окна = поля фикстуры (%i шт. за %i запр.), по возрастанию',
    async (period, step, count, requests) => {
      const from = fromFor(step);
      const { http, calls } = binanceFake(OI.binance[period]);
      const rows = await fetchOiHistoryBinance(http, 'BTCUSDT', period, from);
      const expected = OI.binance[period]
        .filter((r) => r.timestamp >= from)
        .map((r) => ({ t: r.timestamp, usd: Number(r.sumOpenInterestValue) }));
      expect(rows).toEqual(expected);
      expect(rows).toHaveLength(count);
      expect(calls).toHaveLength(requests);
      expect(calls[0].params).toEqual({
        symbol: 'BTCUSDT',
        period,
        limit: 500,
      });
      // Вторая страница — левее первой на мс, без дубля стыка
      if (requests > 1) {
        expect(calls[1].params.endTime).toBe(
          OI.binance[period].at(-500)!.timestamp - 1,
        );
      }
      expect(new Set(rows.map((r) => r.t)).size).toBe(rows.length);
    },
  );

  it('ошибка в теле (-1130, startTime старше 30 дней) → ошибка с кодом', async () => {
    const { http } = recording(() => OI.errors.binanceStartTime);
    await expect(
      fetchOiHistoryBinance(http, 'BTCUSDT', '1h', fromFor(HOUR)),
    ).rejects.toThrow(/-1130/);
  });

  it('неизвестный символ: Binance отвечает [] → «нет данных», не пустой ряд', async () => {
    expect(OI.errors.binanceSymbol).toEqual([]);
    const { http } = recording(() => OI.errors.binanceSymbol);
    await expect(
      fetchOiHistoryBinance(http, 'XXXUSDT', '1h', fromFor(HOUR)),
    ).rejects.toThrow(/нет данных/);
  });

  it('фейк без endTime (страница не сдвинулась) → ошибка, а не вечный цикл', async () => {
    const { http, calls } = recording(() => OI.binance['1h'].slice(-500));
    await expect(
      fetchOiHistoryBinance(http, 'BTCUSDT', '1h', fromFor(HOUR)),
    ).rejects.toThrow(/не сдвинулась/);
    expect(calls).toHaveLength(2);
  });

  it('отрицательный и пустой sumOpenInterestValue → ошибка', async () => {
    for (const bad of ['-1', ' ']) {
      const rows = OI.binance['1d'].map((r, i) =>
        i === 3 ? { ...r, sumOpenInterestValue: bad } : r,
      );
      await expect(
        fetchOiHistoryBinance(
          binanceFake(rows).http,
          'BTCUSDT',
          '1d',
          fromFor(DAY),
        ),
      ).rejects.toThrow(/sumOpenInterestValue/);
    }
  });
});

describe('fetchOiHistoryOkx', () => {
  it.each([
    ['1Dutc', DAY, 31, 1],
    ['1H', HOUR, 721, 8],
  ] as const)(
    '%s: строки окна = 4-й элемент фикстуры (%i шт. за %i запр.), метки как у OKX',
    async (period, step, count, requests) => {
      const from = fromFor(step);
      const { http, calls } = okxFake(OI.okx[period]);
      const rows = await fetchOiHistoryOkx(http, 'BTC-USDT-SWAP', period, from);
      const expected = OI.okx[period]
        .filter((r) => Number(r[0]) >= from)
        .map((r) => ({ t: Number(r[0]), usd: Number(r[3]) }))
        .reverse();
      expect(rows).toEqual(expected);
      expect(rows).toHaveLength(count);
      expect(calls).toHaveLength(requests);
      expect(calls[0].params).toEqual({
        instId: 'BTC-USDT-SWAP',
        period,
        limit: 100,
      });
      if (requests > 1) {
        // end — самая старая метка прошлой страницы (у OKX исключительно)
        expect(calls[1].params.end).toBe(Number(OI.okx[period][99][0]));
      }
      expect(new Set(rows.map((r) => r.t)).size).toBe(rows.length);
    },
  );

  it('ошибка OKX в теле при HTTP 200 (51001) → ошибка с текстом биржи', async () => {
    const { http } = recording(() => OI.errors.okx);
    await expect(
      fetchOiHistoryOkx(http, 'XXX-USDT-SWAP', '1H', fromFor(HOUR)),
    ).rejects.toThrow(/51001/);
  });

  it('страница не сдвинулась → ошибка', async () => {
    const { http } = recording(() => ({
      code: '0',
      data: OI.okx['1H'].slice(0, 100),
    }));
    await expect(
      fetchOiHistoryOkx(http, 'BTC-USDT-SWAP', '1H', fromFor(HOUR)),
    ).rejects.toThrow(/не сдвинулась/);
  });

  it('нет oiUsd в строке → ошибка, не NaN', async () => {
    const rows = OI.okx['1Dutc'].map((r, i) => (i === 2 ? r.slice(0, 3) : r));
    await expect(
      fetchOiHistoryOkx(
        okxFake(rows).http,
        'BTC-USDT-SWAP',
        '1Dutc',
        fromFor(DAY),
      ),
    ).rejects.toThrow(/oiUsd/);
  });
});

describe('fetchOiHistoryBybit', () => {
  it.each([
    ['1d', DAY, 31, 1],
    ['1h', HOUR, 721, 4],
  ] as const)(
    '%s: строки окна = openInterest фикстуры в монетах (%i шт. за %i запр.)',
    async (interval, step, count, requests) => {
      const from = fromFor(step);
      const { http, calls } = bybitFake(OI.bybit[interval]);
      const rows = await fetchOiHistoryBybit(http, 'BTCUSDT', interval, from);
      const expected = OI.bybit[interval]
        .filter((r) => Number(r.timestamp) >= from)
        .map((r) => ({ t: Number(r.timestamp), coin: Number(r.openInterest) }))
        .reverse();
      expect(rows).toEqual(expected);
      expect(rows).toHaveLength(count);
      expect(calls).toHaveLength(requests);
      expect(calls[0].params).toEqual({
        category: 'linear',
        symbol: 'BTCUSDT',
        intervalTime: interval,
        limit: 200,
      });
      expect(new Set(rows.map((r) => r.t)).size).toBe(rows.length);
    },
  );

  it('ошибка Bybit в теле при HTTP 200 (10001) → ошибка', async () => {
    const { http } = recording(() => OI.errors.bybit);
    await expect(
      fetchOiHistoryBybit(http, 'XXXUSDT', '1h', fromFor(HOUR)),
    ).rejects.toThrow(/10001/);
  });

  it('курсор не двигает страницу → ошибка, а не вечный цикл', async () => {
    const { http, calls } = recording(() => ({
      retCode: 0,
      result: { list: OI.bybit['1h'].slice(0, 200), nextPageCursor: 'same' },
    }));
    await expect(
      fetchOiHistoryBybit(http, 'BTCUSDT', '1h', fromFor(HOUR)),
    ).rejects.toThrow(/не сдвинулась/);
    expect(calls).toHaveLength(2);
  });

  it('отрицательный openInterest → ошибка', async () => {
    const rows = OI.bybit['1d'].map((r, i) =>
      i === 1 ? { ...r, openInterest: '-5' } : r,
    );
    await expect(
      fetchOiHistoryBybit(bybitFake(rows).http, 'BTCUSDT', '1d', fromFor(DAY)),
    ).rejects.toThrow(/openInterest/);
  });
});

// Фикстура обрезана (окно + 2 дня): последняя страница в ней всегда
// неполная, и выход по from тестами выше не проверяется (критик T1). Здесь
// история старше окна добита синтетикой до полных страниц — функция обязана
// остановиться на первой странице, ушедшей левее from, а не листать до конца.
const PAD = 2000; // строк старше самой старой в фикстуре
const older = (oldest: number, step: number) =>
  Array.from({ length: PAD }, (_, i) => oldest - (i + 1) * step);

describe('выход по from: страницы старше окна полные (критик T1)', () => {
  it.each([
    ['1d', DAY, 1],
    ['1h', HOUR, 2],
  ] as const)(
    'Binance %s (шаг %i мс): %i запр., строки — только окно',
    async (period, step, requests) => {
      const rows = OI.binance[period];
      const pad = older(rows[0].timestamp, step)
        .reverse()
        .map((t) => ({ ...rows[0], timestamp: t }));
      const from = fromFor(step);
      // Ожидание — по всему, что отдаёт фейк: у Binance первая метка
      // фикстуры позже from, и синтетическая строка может попасть в окно
      const all: Raw[] = [...pad, ...rows];
      const { http, calls } = binanceFake(all);
      const got = await fetchOiHistoryBinance(http, 'BTCUSDT', period, from);
      expect(got.map((r) => r.t)).toEqual(
        all.map((r) => Number(r.timestamp)).filter((t) => t >= from),
      );
      expect(calls).toHaveLength(requests);
    },
  );

  it.each([
    ['1Dutc', DAY, 1],
    ['1H', HOUR, 8],
  ] as const)(
    'OKX %s (шаг %i мс): %i запр., строки — только окно',
    async (period, step, requests) => {
      const rows = OI.okx[period];
      const last = rows[rows.length - 1];
      const pad = older(Number(last[0]), step).map((t) => [
        String(t),
        ...last.slice(1),
      ]);
      const from = fromFor(step);
      const { http, calls } = okxFake([...rows, ...pad]);
      const got = await fetchOiHistoryOkx(http, 'BTC-USDT-SWAP', period, from);
      expect(got.map((r) => r.t)).toEqual(
        rows
          .filter((r) => Number(r[0]) >= from)
          .map((r) => Number(r[0]))
          .reverse(),
      );
      expect(calls).toHaveLength(requests);
    },
  );

  it.each([
    ['1d', DAY, 1],
    ['1h', HOUR, 4],
  ] as const)(
    'Bybit %s (шаг %i мс): %i запр., строки — только окно',
    async (interval, step, requests) => {
      const rows = OI.bybit[interval];
      const last = rows[rows.length - 1];
      const pad = older(Number(last.timestamp), step).map((t) => ({
        ...last,
        timestamp: String(t),
      }));
      const from = fromFor(step);
      const { http, calls } = bybitFake([...rows, ...pad]);
      const got = await fetchOiHistoryBybit(http, 'BTCUSDT', interval, from);
      expect(got.map((r) => r.t)).toEqual(
        rows
          .filter((r) => Number(r.timestamp) >= from)
          .map((r) => Number(r.timestamp))
          .reverse(),
      );
      expect(calls).toHaveLength(requests);
    },
  );
});

describe('fetchMarkBybit', () => {
  it.each(['D', '60'] as const)(
    '%s: начало свечи → open, как в фикстуре',
    async (interval) => {
      const list = OI.bybitMark[interval];
      const { http, calls } = recording(() => ({
        retCode: 0,
        result: { list },
      }));
      const marks = await fetchMarkBybit(http, 'BTCUSDT', interval, 1, 2);
      expect(marks.size).toBe(list.length);
      for (const row of list)
        expect(marks.get(Number(row[0]))).toBe(Number(row[1]));
      expect(calls[0].params).toEqual({
        category: 'linear',
        symbol: 'BTCUSDT',
        interval,
        start: 1,
        end: 2,
        limit: 1000,
      });
    },
  );

  it('ошибка Bybit в теле (10001) → ошибка', async () => {
    const { http } = recording(() => OI.errors.bybitMark);
    await expect(fetchMarkBybit(http, 'XXXUSDT', '60', 1, 2)).rejects.toThrow(
      /10001/,
    );
  });

  it('полная страница (1000) — окно обрезано → ошибка, а не цены с дырой', async () => {
    const list = Array.from({ length: 1000 }, (_, i) => [
      String((i + 1) * HOUR),
      '1',
      '1',
      '1',
      '1',
    ]);
    const { http } = recording(() => ({ retCode: 0, result: { list } }));
    await expect(fetchMarkBybit(http, 'BTCUSDT', '60', 1, 2)).rejects.toThrow(
      /обрезано/,
    );
  });

  it('open 0 → ошибка (цена строго > 0)', async () => {
    const list = [['1000', '0', '1', '1', '1']];
    const { http } = recording(() => ({ retCode: 0, result: { list } }));
    await expect(fetchMarkBybit(http, 'BTCUSDT', '60', 1, 2)).rejects.toThrow(
      /open/,
    );
  });
});
