import type { Regime } from '../market/regime';

// Факт рынка по монете — считает код (digest/market-facts.ts), модель только
// связывает факты словами (TASK-0012). Зеркало — frontend/src/api/news.ts.
export interface MarketFact {
  coinId: string;
  market: string; // 'BTC/USDT'
  price: number; // close последнего закрытого часа
  change24hPct: number; // (close / close 24 ч назад − 1)·100, 2 знака
  volume24hUsd: number; // Σ quoteAssetVolume за 24 ч, USDT
  volumeRatio30d: number; // объём 24 ч / (Σ 720 ч перед ними / 30), 2 знака
  regime: Regime | null; // режим по дневным свечам (TASK-0011); null — не получен
  regimeDays: number | null;
  at: number; // closeTime последнего закрытого часа, мс
}

export interface Digest {
  summary: string | null; // готовый свод; null — текста нет (модель/проверка), факты есть
  generatedAt: string; // ISO
  itemCount: number; // сколько новостей вошло (0 — свод по рынку без ленты)
  market: { facts: MarketFact[]; failed: string[] }; // failed — coinId без фактов
}
