import { api } from './client';
import type {
    MarketRefreshDto,
    MarketSnapshot,
    MarketState,
    PriceSnapshot,
} from "../types/market.ts";

export const refreshMarket = async (
    data: MarketRefreshDto
): Promise<MarketState> => {
    const response = await api.post<MarketState>('/market/refresh', data);
    return response.data;
};

export const getHistory = async (coinId: string, limit = 50): Promise<MarketSnapshot[]> => {
    const response = await api.get<MarketSnapshot[]>(`/market/history/${coinId}`, {
        params: { limit },
    });
    return response.data;
};

// Живёт здесь, хотя ходит на /price/*, а не на /market/*: это единственный
// оставшийся запрос к ценовому слою, на нём стоит график. Отдельный файл под
// одну функцию — лишняя церемония.
export const getPriceHistory = async (coinId: string, limit = 50): Promise<PriceSnapshot[]> => {
    const response = await api.get<PriceSnapshot[]>(`/price/history/${coinId}`, {
        params: { limit },
    });
    return response.data;
};

// null — у монеты ещё нет снимков. Бэкенд в этом случае отвечает 200 с пустым
// телом, и axios отдаёт "" вместо null — нормализуем здесь, а не в App.
export const getLatest = async (coinId: string): Promise<MarketState | null> => {
    const response = await api.get<MarketState | "">(`/market/snapshot/${coinId}`);
    return response.data || null;
};
