import { api } from './client';
import type { Derivatives } from '../types/derivatives';

// Ставка Binance + мера необычности, OI Binance/OKX/Bybit. Неизвестная
// монета — 400; отказ биржи — в её поле, не ошибкой запроса
export const getDerivatives = async (coinId: string): Promise<Derivatives> => {
    const response = await api.get<Derivatives>(`/derivatives/${coinId}`);
    return response.data;
};
