// Поля монеты с CoinGecko (TASK-0010). Ключи — те же coinId, что COINS
// (market/market.types.ts): id монет CoinGecko с ними совпадают
// (research TASK-0010).

// Снимок всех трёх монет живёт 60 с: один запрос к CoinGecko в минуту при
// любом числе вкладок (лимит без ключа не закреплён, PRD критерий 6). У
// CoinGecko свой кэш ответа — s-maxage=60, чаще данные не меняются.
// Кэшируется и ошибка — повтор к упавшему CoinGecko не чаще раза в 60 с
export const COIN_TTL_MS = 60_000;

// Ожидание ответа CoinGecko: зависший источник — 502, а не висящий маршрут
// (как BOOK_TIMEOUT_MS стакана)
export const COIN_TIMEOUT_MS = 10_000;

// Ответ GET /coin/:coinId (зеркало — frontend/src/types/coin.ts). Источник
// один — его отказ = 502 на весь ответ (план TASK-0010, trade-off 2)
export interface CoinFields {
  coinId: string;
  market: string;
  marketCapUsd: number; // market_cap, > 0
  // fully_diluted_valuation. У CoinGecko FDV = цена × total_supply, не ×
  // max_supply (research TASK-0010: у BTC FDV = капитализации)
  fdvUsd: number | null;
  circulating: number; // circulating_supply, монеты, > 0
  total: number | null; // total_supply, монеты
  max: number | null; // max_supply, монеты; null — лимита нет
  updatedAt: number; // last_updated, мс
}
