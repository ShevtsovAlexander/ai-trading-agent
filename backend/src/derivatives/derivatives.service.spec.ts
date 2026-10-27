import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { DerivativesService, SNAPSHOT_TTL_MS } from './derivatives.service';
import { FundingView, SourceError } from './derivatives.types';

type Raw = Record<string, any>;
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   поля фикстуры — сырой JSON бирж */
const LIVE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'live-2026-10-27.json'), 'utf8'),
) as Record<string, Record<string, Raw>>;

const H8 = 8 * 3_600_000;
const DAY = 86_400_000;
// «Сейчас» — момент снятия фикстуры BTC: до выплаты 1793116800000 ещё ~4 ч
const NOW = LIVE.binancePremiumIndex.BTCUSDT.time as number;
const NEXT = LIVE.binancePremiumIndex.BTCUSDT.nextFundingTime as number;

type Source = 'premiumIndex' | 'fundingRate' | 'openInterest' | 'okx' | 'bybit';
const sourceOf = (url: string): Source =>
  url.includes('premiumIndex')
    ? 'premiumIndex'
    : url.includes('fundingRate')
      ? 'fundingRate'
      : url.includes('openInterest')
        ? 'openInterest'
        : url.includes('okx')
          ? 'okx'
          : 'bybit';

// История выплат: шаг 8 ч, последняя — за 8 ч до NEXT, ставка 0,005 %
// (ниже нейтральной и ниже текущей 0,008241 % — хвост «≤ текущей» = 100 %)
const historyRows = (upTo = NEXT - H8, days = 400, step = H8) =>
  Array.from({ length: (days * DAY) / step }, (_, i) => ({
    symbol: 'BTCUSDT',
    fundingTime: upTo - i * step,
    fundingRate: '0.00005000',
  })).reverse();

// Фейк по URL: реальные ответы бирж; история — с фильтром startTime/
// endTime/limit, как Binance. fail — источник отвечает ошибкой сети.
const fakeHttp = () => {
  const calls: Record<Source, Raw[]> = {
    premiumIndex: [],
    fundingRate: [],
    openInterest: [],
    okx: [],
    bybit: [],
  };
  const state = {
    fail: new Set<Source>(),
    history: historyRows(),
  };
  const http = {
    get: (url: string, { params }: { params: Raw }) => {
      const src = sourceOf(url);
      calls[src].push(params);
      if (state.fail.has(src)) {
        return throwError(() => new Error(`${src}: ECONNREFUSED`));
      }
      let data: unknown;
      if (src === 'premiumIndex')
        data = LIVE.binancePremiumIndex[params.symbol];
      else if (src === 'openInterest')
        data = LIVE.binanceOpenInterest[params.symbol];
      else if (src === 'okx') data = LIVE.okxOpenInterest[params.instId];
      else if (src === 'bybit') data = LIVE.bybitTickers[params.symbol];
      else
        data = state.history
          .filter(
            (r) =>
              r.fundingTime >= params.startTime &&
              r.fundingTime <= params.endTime,
          )
          .slice(0, params.limit as number);
      return of({ data, headers: {} });
    },
  };
  return { http: http as unknown as HttpService, calls, state };
};

const makeService = () => {
  const { http, calls, state } = fakeHttp();
  const service = new DerivativesService(http);
  let now = NOW;
  service.clock = () => now;
  const count = () =>
    Object.fromEntries(
      Object.entries(calls).map(([k, v]) => [k, v.length]),
    ) as Record<Source, number>;
  return { service, calls, state, count, advance: (ms: number) => (now += ms) };
};

// Ожидания — из полей фикстуры напрямую, не из кода
const binanceUsd =
  Number(LIVE.binanceOpenInterest.BTCUSDT.openInterest) *
  Number(LIVE.binancePremiumIndex.BTCUSDT.markPrice);
const okxUsd = Number(LIVE.okxOpenInterest['BTC-USDT-SWAP'].data[0].oiUsd);
const bybitUsd = Number(
  LIVE.bybitTickers.BTCUSDT.result.list[0].openInterestValue,
);

describe('DerivativesService.get', () => {
  it('все источники живы: форма по контракту, сумма трёх бирж', async () => {
    const { service } = makeService();
    const d = await service.get('bitcoin');

    expect(d.coinId).toBe('bitcoin');
    expect(d.market).toBe('BTC/USDT');
    const f = d.funding as FundingView;
    expect(f).toMatchObject({
      exchange: 'binance',
      rate: 0.00008241,
      nextFundingTime: NEXT,
      at: NOW,
    });
    // 365 дней по 3 выплаты, все 0,005 % ≤ 0,008241 %
    expect(f.stress).toEqual({
      state: 'below',
      tailPct: 100,
      periodDays: 365,
      samples: 1095,
      intervalHours: 8,
    });
    expect(d.openInterest.exchanges.map((e) => e.exchange)).toEqual([
      'binance',
      'okx',
      'bybit',
    ]);
    expect(d.openInterest.exchanges).toEqual([
      {
        exchange: 'binance',
        usd: binanceUsd,
        at: LIVE.binanceOpenInterest.BTCUSDT.time,
      },
      {
        exchange: 'okx',
        usd: okxUsd,
        at: Number(LIVE.okxOpenInterest['BTC-USDT-SWAP'].data[0].ts),
      },
      { exchange: 'bybit', usd: bybitUsd, at: LIVE.bybitTickers.BTCUSDT.time },
    ]);
    expect(d.openInterest.totalUsd).toBeCloseTo(
      binanceUsd + okxUsd + bybitUsd,
      2,
    );
    // порядок величины — от кода не зависит: ≈ 15,6 млрд USD (research)
    expect(d.openInterest.totalUsd).toBeGreaterThan(15.5e9);
    expect(d.openInterest.totalUsd).toBeLessThan(15.7e9);
  });

  it('ethereum — символы ETH на всех трёх биржах', async () => {
    const { service, calls } = makeService();
    const d = await service.get('ethereum');
    expect(d.market).toBe('ETH/USDT');
    expect(calls.premiumIndex[0].symbol).toBe('ETHUSDT');
    expect(calls.openInterest[0].symbol).toBe('ETHUSDT');
    expect(calls.okx[0].instId).toBe('ETH-USDT-SWAP');
    expect(calls.bybit[0].symbol).toBe('ETHUSDT');
  });

  it('упала OKX: у неё ошибка, сумма — Binance + Bybit, funding на месте', async () => {
    const { service, state } = makeService();
    state.fail.add('okx');
    const d = await service.get('bitcoin');
    expect(d.openInterest.exchanges[1]).toEqual({
      exchange: 'okx',
      error: 'OKX недоступен',
    });
    expect(d.openInterest.totalUsd).toBeCloseTo(binanceUsd + bybitUsd, 2);
    expect((d.funding as FundingView).rate).toBe(0.00008241);
  });

  it('упал premiumIndex: funding и OI Binance — ошибка, OKX + Bybit на месте', async () => {
    const { service, state, calls } = makeService();
    state.fail.add('premiumIndex');
    const d = await service.get('bitcoin');
    expect(d.funding).toEqual({ error: 'Binance недоступен' });
    expect(d.openInterest.exchanges[0]).toEqual({
      exchange: 'binance',
      error: 'Binance недоступен',
    });
    expect(d.openInterest.totalUsd).toBeCloseTo(okxUsd + bybitUsd, 2);
    // без markPrice OI Binance не запрашивался
    expect(calls.openInterest).toHaveLength(0);
  });

  it('упал только openInterest Binance: funding есть, OI Binance — ошибка', async () => {
    const { service, state } = makeService();
    state.fail.add('openInterest');
    const d = await service.get('bitcoin');
    expect((d.funding as FundingView).stress?.state).toBe('below');
    expect(d.openInterest.exchanges[0]).toEqual({
      exchange: 'binance',
      error: 'Binance недоступен',
    });
    expect(d.openInterest.totalUsd).toBeCloseTo(okxUsd + bybitUsd, 2);
  });

  it('упало всё: totalUsd null, маршрут не бросает', async () => {
    const { service, state } = makeService();
    for (const s of [
      'premiumIndex',
      'fundingRate',
      'openInterest',
      'okx',
      'bybit',
    ] as const) {
      state.fail.add(s);
    }
    const d = await service.get('bitcoin');
    expect(d.funding).toEqual({ error: 'Binance недоступен' } as SourceError);
    expect(d.openInterest.totalUsd).toBeNull();
    expect(d.openInterest.exchanges.every((e) => 'error' in e)).toBe(true);
  });

  it('история не загрузилась: stress null, ставка есть', async () => {
    const { service, state } = makeService();
    state.fail.add('fundingRate');
    const f = (await service.get('bitcoin')).funding as FundingView;
    expect(f.rate).toBe(0.00008241);
    expect(f.stress).toBeNull();
  });

  it('история запрашивается со startTime = now − 366 дн по now', async () => {
    const { service, calls } = makeService();
    await service.get('bitcoin');
    expect(calls.fundingRate[0]).toMatchObject({
      symbol: 'BTCUSDT',
      startTime: NOW - 366 * DAY,
      endTime: NOW,
    });
  });

  it('кэш: в пределах 30 с — 0 запросов; после — снимок заново, история нет', async () => {
    const { service, count, advance } = makeService();
    await service.get('bitcoin');
    const first = count();
    expect(first.premiumIndex).toBe(1);
    expect(first.fundingRate).toBeGreaterThan(0);

    advance(SNAPSHOT_TTL_MS - 1);
    await service.get('bitcoin');
    expect(count()).toEqual(first);

    advance(1);
    await service.get('bitcoin');
    const second = count();
    expect(second.premiumIndex).toBe(2);
    expect(second.okx).toBe(2);
    expect(second.bybit).toBe(2);
    expect(second.openInterest).toBe(2);
    // до nextFundingTime история та же
    expect(second.fundingRate).toBe(first.fundingRate);
  });

  it('после nextFundingTime история запрашивается заново', async () => {
    const { service, count, advance } = makeService();
    await service.get('bitcoin');
    const before = count().fundingRate;
    advance(NEXT - NOW); // ровно момент выплаты
    await service.get('bitcoin');
    expect(count().fundingRate).toBeGreaterThan(before);
  });

  it('в истории нет последней выплаты — не кэшируется, следующий снимок спросит снова', async () => {
    const { service, state, count, advance } = makeService();
    state.history = historyRows(NEXT - 2 * H8); // последняя выплата пропущена
    await service.get('bitcoin');
    const before = count().fundingRate;
    advance(SNAPSHOT_TTL_MS);
    await service.get('bitcoin');
    expect(count().fundingRate).toBeGreaterThan(before);
  });

  it('интервал 4 ч, последняя выплата пропущена — не кэшируется (критик T4)', async () => {
    const { service, state, count, advance } = makeService();
    const H4 = H8 / 2;
    // выплаты каждые 4 ч, но последняя (NEXT − 4 ч) ещё не отдана:
    // до NEXT 8 ч — как при интервале 8 ч, а шаг истории 4 ч
    state.history = historyRows(NEXT - H8, 400, H4);
    await service.get('bitcoin');
    const before = count().fundingRate;
    advance(SNAPSHOT_TTL_MS);
    await service.get('bitcoin');
    expect(count().fundingRate).toBeGreaterThan(before);
  });

  it('ответ с ошибкой биржи держится 30 с, потом биржа спрашивается снова', async () => {
    const { service, state, count, advance } = makeService();
    state.fail.add('okx');
    const first = await service.get('bitcoin');
    expect(first.openInterest.exchanges[1]).toHaveProperty('error');
    state.fail.delete('okx'); // OKX ожила
    advance(SNAPSHOT_TTL_MS - 1);
    const cached = await service.get('bitcoin');
    expect(cached.openInterest.exchanges[1]).toHaveProperty('error');
    expect(count().okx).toBe(1);
    advance(1);
    const fresh = await service.get('bitcoin');
    expect(fresh.openInterest.exchanges[1]).toMatchObject({
      exchange: 'okx',
      usd: okxUsd,
    });
    expect(count().okx).toBe(2);
  });

  it('кэш у монет раздельный', async () => {
    const { service, count } = makeService();
    await service.get('bitcoin');
    await service.get('solana');
    expect(count().premiumIndex).toBe(2);
  });

  it('неизвестная монета → 400 без запросов', async () => {
    const { service, count } = makeService();
    await expect(service.get('dogecoin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.get('__proto__')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(Object.values(count()).every((n) => n === 0)).toBe(true);
  });
});
