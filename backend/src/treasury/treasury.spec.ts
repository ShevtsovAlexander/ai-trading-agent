/**
 * Компании-держатели (TASK-0013): разбор реальных ответов CoinGecko
 * public_treasury трёх монет (фикстура curl) против эталона python; сервис —
 * кэш, отказы, доля от «в обращении» CoinService.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosHeaders } from 'axios';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CoinService } from '../coin/coin.service';
import { fetchTreasury, parseTreasury } from './sources';
import { TreasuryService } from './treasury.service';
import { TREASURY_ERROR_TTL_MS, TREASURY_TTL_MS } from './treasury.types';

const FX = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'public-treasury-2026-11-03.json'),
    'utf8',
  ),
) as {
  raw: Record<string, Record<string, unknown>>;
  oracle: Record<string, ReturnType<typeof parseTreasury>>;
};
const IDS = ['bitcoin', 'ethereum', 'solana'] as const;

describe('parseTreasury — реальные ответы CoinGecko', () => {
  IDS.forEach((id) =>
    it(`${id}: итоги, число компаний и топ-5 = эталону python`, () => {
      expect(parseTreasury(FX.raw[id])).toEqual(FX.oracle[id]);
    }),
  );

  it('порядок источника не важен — топ сортируется по держаниям', () => {
    const raw = FX.raw.bitcoin;
    const shuffled = {
      ...raw,
      companies: [...(raw.companies as unknown[])].reverse(),
    };
    expect(parseTreasury(shuffled).top).toEqual(FX.oracle.bitcoin.top);
  });

  it('порча — ошибка с именем поля', () => {
    const raw = FX.raw.solana;
    const c0 = (raw.companies as Record<string, unknown>[])[0];
    const withC0 = (patch: Record<string, unknown>) => ({
      ...raw,
      companies: [{ ...c0, ...patch }],
    });
    expect(() => parseTreasury(null)).toThrow('ответ не объект');
    expect(() => parseTreasury({ ...raw, companies: {} })).toThrow(
      'companies — не массив',
    );
    expect(() => parseTreasury({ ...raw, total_holdings: '1' })).toThrow(
      'total_holdings',
    );
    expect(() => parseTreasury(withC0({ total_holdings: -1 }))).toThrow(
      'companies[0].total_holdings',
    );
    expect(() =>
      parseTreasury(withC0({ total_current_value_usd: NaN })),
    ).toThrow('companies[0].total_current_value_usd');
    expect(() => parseTreasury(withC0({ name: undefined }))).toThrow(
      'companies[0].name',
    );
  });

  it('запрос — public_treasury/{coinId}', async () => {
    const urls: string[] = [];
    const http = {
      get: (url: string) => {
        urls.push(url);
        return of({ data: FX.raw.ethereum });
      },
    } as unknown as HttpService;
    await fetchTreasury(http, 'ethereum');
    expect(urls).toEqual([
      'https://api.coingecko.com/api/v3/companies/public_treasury/ethereum',
    ]);
  });
});

describe('TreasuryService', () => {
  const CIRC: Record<string, number> = {
    bitcoin: 20_100_000,
    ethereum: 120_700_000,
    solana: 560_000_000,
  };
  const setup = (opts: { fail?: 'net' | 429; coinFail?: boolean } = {}) => {
    let calls = 0;
    const http = {
      get: (url: string) => {
        calls++;
        if (opts.fail === 'net')
          return throwError(() => new Error('ECONNRESET'));
        if (opts.fail === 429) {
          return throwError(
            () =>
              new AxiosError('429', 'ERR_BAD_REQUEST', undefined, undefined, {
                status: 429,
                statusText: '',
                headers: {},
                config: { headers: new AxiosHeaders() },
                data: {},
              }),
          );
        }
        return of({ data: FX.raw[url.split('/').pop() as string] });
      },
    } as unknown as HttpService;
    const coin = {
      get: jest.fn((id: string) =>
        opts.coinFail
          ? Promise.reject(new BadGatewayException('CoinGecko недоступен'))
          : Promise.resolve({ circulating: CIRC[id] }),
      ),
    } as unknown as CoinService;
    const service = new TreasuryService(http, coin);
    let now = 1_793_700_000_000;
    service.clock = () => now;
    jest
      .spyOn(
        (service as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    return {
      service,
      calls: () => calls,
      advance: (ms: number) => (now += ms),
      now: () => now,
    };
  };

  it('ответ = разбору + market + доля от «в обращении» CoinService', async () => {
    const { service, now } = setup();
    for (const id of IDS) {
      const o = FX.oracle[id];
      expect(await service.get(id)).toEqual({
        coinId: id,
        market: {
          bitcoin: 'BTC/USDT',
          ethereum: 'ETH/USDT',
          solana: 'SOL/USDT',
        }[id],
        ...o,
        shareOfCirculatingPct: parseFloat(
          ((o.totalHoldings / CIRC[id]) * 100).toFixed(2),
        ),
        fetchedAt: now(),
      });
    }
    // известный ответ: 1 314 155,22 / 20 100 000 = 6,54 %
    expect((await service.get('bitcoin')).shareOfCirculatingPct).toBe(6.54);
  });

  it('кэш 1 ч по монете: граница ±1 мс; другая монета — свой запрос', async () => {
    const { service, calls, advance } = setup();
    await service.get('bitcoin');
    advance(TREASURY_TTL_MS - 1);
    await service.get('bitcoin');
    expect(calls()).toBe(1);
    await service.get('ethereum');
    expect(calls()).toBe(2);
    advance(1);
    await service.get('bitcoin');
    expect(calls()).toBe(3);
  });

  it('параллельные вызовы до снимка — один запрос', async () => {
    const { service, calls } = setup();
    await Promise.all([
      service.get('solana'),
      service.get('solana'),
      service.get('solana'),
    ]);
    expect(calls()).toBe(1);
  });

  it('отказ сети — 502 «CoinGecko недоступен», ошибка в кэше 60 с', async () => {
    const { service, calls, advance } = setup({ fail: 'net' });
    await expect(service.get('bitcoin')).rejects.toThrow(
      new BadGatewayException('CoinGecko недоступен'),
    );
    advance(TREASURY_ERROR_TTL_MS - 1);
    await expect(service.get('bitcoin')).rejects.toThrow(BadGatewayException);
    expect(calls()).toBe(1);
    advance(1);
    await expect(service.get('bitcoin')).rejects.toThrow(BadGatewayException);
    expect(calls()).toBe(2);
  });

  it('429 — «CoinGecko: превышен лимит запросов»', async () => {
    const { service } = setup({ fail: 429 });
    await expect(service.get('bitcoin')).rejects.toThrow(
      'CoinGecko: превышен лимит запросов',
    );
  });

  it('поля монеты недоступны — доля null, держания есть', async () => {
    const { service } = setup({ coinFail: true });
    const t = await service.get('ethereum');
    expect(t.shareOfCirculatingPct).toBeNull();
    expect(t.totalHoldings).toBe(FX.oracle.ethereum.totalHoldings);
  });

  it('неизвестная монета — 400 без запроса', async () => {
    const { service, calls } = setup();
    await expect(service.get('dogecoin')).rejects.toThrow(BadRequestException);
    expect(calls()).toBe(0);
  });
});
