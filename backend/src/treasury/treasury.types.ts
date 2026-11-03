// Компании-держатели (TASK-0013): сколько монет держат публичные компании —
// CoinGecko companies/public_treasury. Не ETF и не фонды; снимок, не поток.
// Зеркало — frontend/src/types/treasury.ts, формы меняются вместе.

export interface TreasuryCompany {
  name: string;
  symbol: string; // тикер акции, 'MSTR.US'
  country: string;
  holdings: number; // монет
  valueUsd: number; // текущая стоимость по CoinGecko
}

export interface Treasury {
  coinId: string;
  market: string; // 'BTC/USDT'
  totalHoldings: number; // монет у всех компаний списка
  totalValueUsd: number;
  companies: number; // компаний в списке
  // totalHoldings / в обращении (CoinGecko, как карточка «Монета») · 100,
  // 2 знака; null — поля монеты недоступны
  shareOfCirculatingPct: number | null;
  top: TreasuryCompany[]; // 5 крупнейших по holdings
  fetchedAt: number; // момент ответа CoinGecko, мс
}

// Держания меняются с отчётами компаний — снимок на час; ошибка — на минуту
export const TREASURY_TTL_MS = 60 * 60_000;
export const TREASURY_ERROR_TTL_MS = 60_000;
export const TREASURY_TIMEOUT_MS = 10_000;
export const TOP_COMPANIES = 5;
