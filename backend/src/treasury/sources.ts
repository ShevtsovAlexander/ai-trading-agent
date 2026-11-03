import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { TOP_COMPANIES, TreasuryCompany } from './treasury.types';

const URL = 'https://api.coingecko.com/api/v3/companies/public_treasury';

export interface ParsedTreasury {
  totalHoldings: number;
  totalValueUsd: number;
  companies: number;
  top: TreasuryCompany[];
}

const num = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error(`CoinGecko treasury: поле ${field} — не число ≥ 0`);
  }
  return v;
};

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string') {
    throw new Error(`CoinGecko treasury: поле ${field} — не строка`);
  }
  return v;
};

// Строгий разбор, как coin/sources.ts: нет поля или не число — ошибка
// источника, а не 0 на экране. total_entry_value_usd не берём: у половины
// компаний он 0 (пусто), research TASK-0013.
export function parseTreasury(raw: unknown): ParsedTreasury {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('CoinGecko treasury: ответ не объект');
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.companies)) {
    throw new Error('CoinGecko treasury: поле companies — не массив');
  }
  const companies = r.companies.map((c: unknown, i: number) => {
    if (typeof c !== 'object' || c === null) {
      throw new Error(`CoinGecko treasury: компания ${i} — не объект`);
    }
    const x = c as Record<string, unknown>;
    return {
      name: str(x.name, `companies[${i}].name`),
      symbol: str(x.symbol, `companies[${i}].symbol`),
      country: str(x.country, `companies[${i}].country`),
      holdings: num(x.total_holdings, `companies[${i}].total_holdings`),
      valueUsd: num(
        x.total_current_value_usd,
        `companies[${i}].total_current_value_usd`,
      ),
    };
  });
  // Порядок источника не обещан — сортируем сами
  const top = [...companies]
    .sort((a, b) => b.holdings - a.holdings)
    .slice(0, TOP_COMPANIES);
  return {
    totalHoldings: num(r.total_holdings, 'total_holdings'),
    totalValueUsd: num(r.total_value_usd, 'total_value_usd'),
    companies: companies.length,
    top,
  };
}

export async function fetchTreasury(
  http: HttpService,
  coinId: string,
): Promise<ParsedTreasury> {
  const res = await firstValueFrom(http.get<unknown>(`${URL}/${coinId}`));
  return parseTreasury(res.data);
}
