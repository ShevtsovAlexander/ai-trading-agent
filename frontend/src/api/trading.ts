import axios from 'axios';
import type {
    AnalyzeRequest,
    AnalyzeResponse,
    TradeDecision,
    PriceSnapshot,
} from "../types/trading.ts";

export const api = axios.create({
    baseURL: 'http://localhost:3000',
});

export const analyzeMarket = async (data: AnalyzeRequest): Promise<AnalyzeResponse> => {
    const response = await api.post<AnalyzeResponse>('/analyze', data);
    return response.data;
};

export const getPrice = async (coinId: string): Promise<number> => {
    const response = await api.get<{ price: number }>(`/price/${coinId}`);
    return response.data.price;
};

export const getPriceHistory = async (coinId: string, limit = 50): Promise<PriceSnapshot[]> => {
    const response = await api.get<PriceSnapshot[]>(`/price/history/${coinId}`, {
        params: { limit },
    });
    return response.data;
};

export const getDecisions = async (coinId: string, limit = 50): Promise<TradeDecision[]> => {
    const response = await api.get<TradeDecision[]>(`/analyze/decisions/${coinId}`, {
        params: { limit },
    });
    return response.data;
};
