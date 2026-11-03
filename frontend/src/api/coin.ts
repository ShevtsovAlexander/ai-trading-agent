import { api } from './client';
import type { CoinFields } from '../types/coin';

// Капитализация, FDV, предложение с CoinGecko (TASK-0010). Неизвестная
// монета — 400; отказ CoinGecko — 502 с текстом (classify → errorText)
export const getCoinFields = async (coinId: string): Promise<CoinFields> => {
    const response = await api.get<CoinFields>(`/coin/${coinId}`);
    return response.data;
};
