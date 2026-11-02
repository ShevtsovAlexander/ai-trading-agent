import { api } from './client';
import type { OrderBookSnapshot } from '../types/orderbook';

// Стены стакана спота Binance + OKX (TASK-0009). Неизвестная монета — 400;
// отказ биржи — в её поле, не ошибкой запроса
export const getOrderBook = async (coinId: string): Promise<OrderBookSnapshot> => {
    const response = await api.get<OrderBookSnapshot>(`/orderbook/${coinId}`);
    return response.data;
};
