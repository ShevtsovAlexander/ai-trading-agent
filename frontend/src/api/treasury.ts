import { api } from './client';
import type { Treasury } from '../types/treasury';

// Компании-держатели монеты (TASK-0013). Неизвестная монета — 400; отказ
// CoinGecko — 502 с текстом (classify → errorText)
export const getTreasury = async (coinId: string): Promise<Treasury> => {
    const response = await api.get<Treasury>(`/treasury/${coinId}`);
    return response.data;
};
