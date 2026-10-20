import { api } from './client';
import type { Interval, MarketSeries, MarketView, Range } from "../types/market.ts";

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

// Последняя закрытая свеча интервала + AI-комментарий к ней
export const getView = async (coinId: string, interval: Interval): Promise<MarketView> => {
    const response = await api.get<MarketView>(`/market/view/${coinId}`, {
        params: { interval },
    });
    return response.data;
};
