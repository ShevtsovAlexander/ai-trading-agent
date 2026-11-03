import { api } from './client';

export interface NewsItem {
    id: string;
    title: string;
    link: string;
    source: string;
    category: string | null;
    imageUrl: string | null;
    publishedAt: string;
}

export const getNews = async (): Promise<NewsItem[]> => {
    const { data } = await api.get<NewsItem[]>('/news');
    return data;
};

// Факт рынка по монете — посчитан кодом бэкенда (TASK-0012). Зеркало
// backend/src/digest/digest.types.ts — формы меняются вместе.
export interface MarketFact {
    coinId: string;
    market: string; // 'BTC/USDT'
    price: number; // close последнего закрытого часа
    change24hPct: number; // за 24 ч, %, 2 знака
    volume24hUsd: number; // объём за 24 ч, USDT
    volumeRatio30d: number; // к среднему суточному за 30 дней, 2 знака
    regime: 'up' | 'down' | 'range' | null; // режим по дневным свечам; null — не получен
    regimeDays: number | null;
    at: number; // closeTime последнего часа, мс
}

export interface Digest {
    summary: string | null; // null — текста нет (модель недоступна / ответ не прошёл проверку)
    generatedAt: string;
    itemCount: number; // заголовков в своде (0 — свод по рынку)
    market: { facts: MarketFact[]; failed: string[] }; // failed — coinId без фактов
}

export const getDigest = async (): Promise<Digest | null> => {
    const { data } = await api.get<Digest | null>('/news/digest');
    return data;
};
