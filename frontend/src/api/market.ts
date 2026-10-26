import { api } from './client';
import type { HistoryChunk, Interval, MarketSeries, MarketView, Range } from "../types/market.ts";

// Свечи диапазона + ряды индикаторов. Недопустимая комбинация — 400,
// Binance недоступен — 502.
export const getCandles = async (
    coinId: string,
    interval: Interval,
    range: Range
): Promise<MarketSeries> => {
    const response = await api.get<MarketSeries>(`/market/candles/${coinId}`, {
        params: { interval, range },
    });
    return response.data;
};

// Кусок истории левее before (openTime, мс). Невалидный before — 400,
// лимит Binance — 429, Binance недоступен — 502.
export const getHistory = async (
    coinId: string,
    interval: Interval,
    before: number
): Promise<HistoryChunk> => {
    const response = await api.get<HistoryChunk>(`/market/candles/${coinId}/history`, {
        params: { interval, before },
    });
    return response.data;
};

// Последняя закрытая свеча интервала + AI-комментарий к ней
export const getView = async (coinId: string, interval: Interval): Promise<MarketView> => {
    const response = await api.get<MarketView>(`/market/view/${coinId}`, {
        params: { interval },
    });
    return response.data;
};
