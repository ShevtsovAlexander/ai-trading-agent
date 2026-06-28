import axios from 'axios';
import type {
    AnalyzeRequest,
    AnalyzeResponse,
    Position,
    Wallet,
    WalletStats,
    TradeDecision,
    PriceSnapshot,
} from "../types/trading.ts";

const api = axios.create({
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

export const getWallet = async (): Promise<Wallet> => {
    const response = await api.get<Wallet>('/wallet');
    return response.data;
};

export const getWalletStats = async (
    period: 'day' | 'week' | 'month' | 'all' = 'all'
): Promise<WalletStats> => {
    const response = await api.get<WalletStats>('/wallet/stats', { params: { period } });
    return response.data;
};

export const deposit = async (amount: number): Promise<Wallet> => {
    const response = await api.post<Wallet>('/wallet/deposit', { amount });
    return response.data;
};

export const getBalanceHistory = async (
    period: 'day' | 'week' | 'month' | 'all' = 'all'
): Promise<{ date: string; balance: number }[]> => {
    const response = await api.get(`/wallet/history`, { params: { period } });
    return response.data;
};

// --- новые ---

export const getPositions = async (): Promise<Position[]> => {
    const response = await api.get<Position[]>('/positions');
    return response.data;
};

export const getOpenPosition = async (coinId: string): Promise<Position | null> => {
    const response = await api.get<Position | null>(`/positions/${coinId}/open`);
    return response.data;
};