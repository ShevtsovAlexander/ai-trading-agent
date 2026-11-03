import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CoinFields } from './coin.types';

const MARKETS = 'https://api.coingecko.com/api/v3/coins/markets';
const SRC = 'CoinGecko';

// Поля монет одним запросом. Как derivatives/sources.ts: свободная функция
// с HttpService аргументом, ошибки сети не ловит — их переводит вызывающий.
// Разбор строгий: у CoinGecko числа — JSON number (не строки, как у бирж),
// поэтому свой разбор, а не num(); не конечное, ≤ 0 или не того типа —
// Error с именем поля, а не NaN на экране.

type Fields = Omit<CoinFields, 'market'>;

const required = (id: string, field: string, v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`${SRC}: ${id}.${field} не число > 0 (${String(v)})`);
  }
  return v;
};

// null — поля нет у монеты (max_supply ETH/SOL — лимита нет)
const optional = (id: string, field: string, v: unknown): number | null =>
  v === null ? null : required(id, field, v);

const time = (id: string, v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t) || t <= 0) {
    throw new Error(`${SRC}: ${id}.last_updated не время (${String(v)})`);
  }
  return t;
};

// Ответ coins/markets → поля по id. Монеты, которой нет в ответе, нет и в
// словаре — решает вызывающий. Порядок массива — по капитализации, не по ids
export const parseMarkets = (raw: unknown): Map<string, Fields> => {
  if (!Array.isArray(raw)) throw new Error(`${SRC}: ответ не массив`);
  const out = new Map<string, Fields>();
  for (const row of raw as unknown[]) {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`${SRC}: строка ответа не объект`);
    }
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '') {
      throw new Error(`${SRC}: строка без id`);
    }
    const id = r.id;
    out.set(id, {
      coinId: id,
      marketCapUsd: required(id, 'market_cap', r.market_cap),
      fdvUsd: optional(
        id,
        'fully_diluted_valuation',
        r.fully_diluted_valuation,
      ),
      circulating: required(id, 'circulating_supply', r.circulating_supply),
      total: optional(id, 'total_supply', r.total_supply),
      max: optional(id, 'max_supply', r.max_supply),
      updatedAt: time(id, r.last_updated),
    });
  }
  return out;
};

export async function fetchMarkets(
  http: HttpService,
  ids: string[],
): Promise<Map<string, Fields>> {
  const res = await firstValueFrom(
    http.get<unknown>(MARKETS, {
      params: { vs_currency: 'usd', ids: ids.join(',') },
    }),
  );
  return parseMarkets(res.data);
}
