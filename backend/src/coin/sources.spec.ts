import { readFileSync } from 'fs';
import { join } from 'path';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { fetchMarkets, parseMarkets } from './sources';

// Оракул: реальный ответ CoinGecko coins/markets (curl 2026-11-02, без
// ключа) — числа ниже выписаны из него независимо (python json), а не из
// разбора; порча — известный ответ «ошибка с именем поля».
type Raw = Record<string, unknown>;
const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'markets-2026-11-02.json'), 'utf8'),
) as Raw[];

const UPDATED = Date.UTC(2026, 10, 2, 15, 7, 45);
// Перестановку полей ловит только SOL: у BTC и ETH market_cap = FDV и
// circulating = total (критик T1). Новая фикстура — проверить, что у
// одной монеты все четыре числа разные
const EXPECTED = {
  bitcoin: {
    coinId: 'bitcoin',
    marketCapUsd: 1563111806711,
    fdvUsd: 1563111806711,
    circulating: 20105365,
    total: 20105365,
    max: 21000000,
    updatedAt: UPDATED,
  },
  ethereum: {
    coinId: 'ethereum',
    marketCapUsd: 279181675180,
    fdvUsd: 279181675180,
    circulating: 122183191.98331761,
    total: 122183191.98331761,
    max: null,
    updatedAt: UPDATED,
  },
  solana: {
    coinId: 'solana',
    marketCapUsd: 55584084585,
    fdvUsd: 59980065978,
    circulating: 590205898.3057915,
    total: 636883542.9263542,
    max: null,
    updatedAt: UPDATED,
  },
};

// Копия фикстуры с подменённым полем одной монеты
const spoil = (id: string, field: string, value: unknown): Raw[] =>
  FX.map((r) => (r.id === id ? { ...r, [field]: value } : r));

describe('parseMarkets — реальный ответ CoinGecko', () => {
  const parsed = parseMarkets(FX);

  it('три монеты, порядок ответа не важен', () => {
    expect([...parsed.keys()].sort()).toEqual([
      'bitcoin',
      'ethereum',
      'solana',
    ]);
  });

  it.each(Object.keys(EXPECTED))('%s — все поля = ответу', (id) => {
    expect(parsed.get(id)).toEqual(EXPECTED[id as keyof typeof EXPECTED]);
  });

  it('max_supply null (лимита нет) остаётся null, не 0', () => {
    expect(parsed.get('ethereum')!.max).toBeNull();
    expect(parsed.get('solana')!.max).toBeNull();
  });

  it('пустой массив — пустой словарь, не ошибка', () => {
    expect(parseMarkets([]).size).toBe(0);
  });
});

describe('parseMarkets — порча', () => {
  it('ответ не массив', () => {
    expect(() => parseMarkets({ status: { error_code: 429 } })).toThrow(
      'CoinGecko: ответ не массив',
    );
  });

  it('строка не объект и без id', () => {
    expect(() => parseMarkets([null])).toThrow('не объект');
    expect(() => parseMarkets([{ ...FX[0], id: '' }])).toThrow('без id');
  });

  it.each([
    ['market_cap', '1563111806711'], // строка вместо числа
    ['market_cap', null], // обязательное пропало
    ['market_cap', 0],
    ['circulating_supply', -1],
    ['circulating_supply', NaN],
    ['fully_diluted_valuation', Infinity],
    ['total_supply', 0],
    ['max_supply', '21000000'],
    ['max_supply', undefined], // поля нет — не то же, что null
  ])('%s = %p — ошибка с именем поля', (field, value) => {
    expect(() => parseMarkets(spoil('bitcoin', field, value))).toThrow(
      `CoinGecko: bitcoin.${field}`,
    );
  });

  it.each([['не дата'], [''], [1793632065000], [null]])(
    'last_updated = %p — ошибка',
    (value) => {
      expect(() =>
        parseMarkets(spoil('solana', 'last_updated', value)),
      ).toThrow('CoinGecko: solana.last_updated не время');
    },
  );
});

describe('fetchMarkets', () => {
  it('один запрос coins/markets с ids через запятую и usd', async () => {
    const calls: { url: string; params: Raw }[] = [];
    const http = {
      get: (url: string, { params }: { params: Raw }) => {
        calls.push({ url, params });
        return of({ data: FX });
      },
    } as unknown as HttpService;
    const res = await fetchMarkets(http, ['bitcoin', 'ethereum', 'solana']);
    expect(calls).toEqual([
      {
        url: 'https://api.coingecko.com/api/v3/coins/markets',
        params: { vs_currency: 'usd', ids: 'bitcoin,ethereum,solana' },
      },
    ]);
    expect(res.get('bitcoin')).toEqual(EXPECTED.bitcoin);
  });
});
