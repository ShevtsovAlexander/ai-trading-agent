import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosHeaders } from 'axios';
import { Observable, of, throwError } from 'rxjs';
import { CoinModule } from './coin.module';
import { CoinService } from './coin.service';
import { COIN_TIMEOUT_MS, COIN_TTL_MS } from './coin.types';
import { parseMarkets } from './sources';

// Оракул: ответ сервиса = parseMarkets на той же фикстуре (разбор сверен
// с реальным ответом в sources.spec) + market из COINS; кэш и общий запрос
// — известный ответ (счётчик запросов к фейку). Отказы — как в жизни:
// ошибка сети, HTTP 429 от axios, монеты нет в массиве.
type Raw = Record<string, unknown>;
const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'markets-2026-11-02.json'), 'utf8'),
) as Raw[];
const PARSED = parseMarkets(FX);
const MARKET = {
  bitcoin: 'BTC/USDT',
  ethereum: 'ETH/USDT',
  solana: 'SOL/USDT',
};
const NOW = 1_793_632_000_000;

type Mode = 'ok' | 'network' | '429' | 'nosol' | 'slow';

const fakeHttp = () => {
  const state = { calls: [] as Raw[], mode: 'ok' as Mode };
  let release: () => void = () => {};
  const http = {
    get: (url: string, { params }: { params: Raw }) => {
      state.calls.push({ url, ...params });
      switch (state.mode) {
        case 'network':
          return throwError(() => new Error('ECONNREFUSED'));
        case '429': {
          const e = new AxiosError('Request failed with status code 429');
          e.response = {
            status: 429,
            statusText: 'Too Many Requests',
            data: {},
            headers: {},
            config: { headers: new AxiosHeaders() },
          };
          return throwError(() => e);
        }
        case 'nosol':
          return of({ data: FX.filter((r) => r.id !== 'solana') });
        case 'slow':
          return new Observable((sub) => {
            release = () => {
              sub.next({ data: FX });
              sub.complete();
            };
          });
        default:
          return of({ data: FX });
      }
    },
  };
  return { http, state, release: () => release() };
};

const make = async () => {
  const fake = fakeHttp();
  const mod = await Test.createTestingModule({ imports: [CoinModule] })
    .overrideProvider(HttpService)
    .useValue(fake.http)
    .compile();
  const service = mod.get(CoinService);
  let now = NOW;
  service.clock = () => now;
  return { service, ...fake, tick: (ms: number) => (now += ms) };
};

const message = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(HttpException);
  return (e as HttpException).getResponse() as { message: string };
};

describe('CoinService', () => {
  it.each(Object.keys(MARKET))(
    '%s — ответ = разбору фикстуры + market',
    async (id) => {
      const { service } = await make();
      expect(await service.get(id)).toEqual({
        ...PARSED.get(id),
        market: MARKET[id as keyof typeof MARKET],
      });
    },
  );

  it('один запрос на все три монеты, ids = монеты дашборда', async () => {
    const { service, state } = await make();
    for (const id of Object.keys(MARKET)) await service.get(id);
    expect(state.calls).toEqual([
      {
        url: 'https://api.coingecko.com/api/v3/coins/markets',
        vs_currency: 'usd',
        ids: 'bitcoin,ethereum,solana',
      },
    ]);
  });

  it('400 на неизвестную монету — без запроса', async () => {
    const { service, state } = await make();
    await expect(service.get('dogecoin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.get('toString')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.calls).toHaveLength(0);
  });

  it('кэш 60 с: граница ±1 мс', async () => {
    const { service, state, tick } = await make();
    await service.get('bitcoin');
    tick(COIN_TTL_MS - 1);
    await service.get('ethereum');
    expect(state.calls).toHaveLength(1);
    tick(1);
    await service.get('bitcoin');
    expect(state.calls).toHaveLength(2);
  });

  it('отказ сети — 502 «CoinGecko недоступен», ошибка кэшируется 60 с', async () => {
    const { service, state, tick } = await make();
    state.mode = 'network';
    const p = service.get('bitcoin');
    await expect(p).rejects.toBeInstanceOf(BadGatewayException);
    expect((await message(p)).message).toBe('CoinGecko недоступен');
    tick(COIN_TTL_MS - 1);
    state.mode = 'ok';
    await expect(service.get('solana')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(state.calls).toHaveLength(1);
    tick(1);
    await expect(service.get('solana')).resolves.toMatchObject({
      coinId: 'solana',
    });
    expect(state.calls).toHaveLength(2);
  });

  it('HTTP 429 — 502 «превышен лимит»', async () => {
    const { service, state } = await make();
    state.mode = '429';
    expect((await message(service.get('ethereum'))).message).toBe(
      'CoinGecko: превышен лимит запросов',
    );
  });

  it('монеты нет в ответе — 502 по ней, остальные на месте', async () => {
    const { service, state } = await make();
    state.mode = 'nosol';
    expect((await message(service.get('solana'))).message).toBe(
      'CoinGecko не отдал монету',
    );
    await expect(service.get('bitcoin')).resolves.toMatchObject({
      coinId: 'bitcoin',
    });
    expect(state.calls).toHaveLength(1);
  });

  it('параллельные запросы при пустом кэше — один запрос; TTL от ответа', async () => {
    const { service, state, release, tick } = await make();
    state.mode = 'slow';
    const all = Promise.all(
      ['bitcoin', 'ethereum', 'solana', 'bitcoin'].map((id) => service.get(id)),
    );
    tick(5_000); // ответ пришёл через 5 с
    release();
    const res = await all;
    expect(res.map((r) => r.coinId)).toEqual([
      'bitcoin',
      'ethereum',
      'solana',
      'bitcoin',
    ]);
    expect(state.calls).toHaveLength(1);
    tick(COIN_TTL_MS - 1); // от ответа, не от запроса
    state.mode = 'ok';
    await service.get('bitcoin');
    expect(state.calls).toHaveLength(1);
  });

  it('таймаут клиента 10 с', async () => {
    const mod = await Test.createTestingModule({
      imports: [CoinModule],
    }).compile();
    const http = mod.get(HttpService);
    expect(COIN_TIMEOUT_MS).toBe(10_000);
    expect(http.axiosRef.defaults.timeout).toBe(COIN_TIMEOUT_MS);
  });
});
