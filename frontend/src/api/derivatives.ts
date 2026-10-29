import { api } from './client';
import type { Derivatives, OiStep, OpenInterestHistory } from '../types/derivatives';

// Ставка Binance + мера необычности, OI Binance/OKX/Bybit. Неизвестная
// монета — 400; отказ биржи — в её поле, не ошибкой запроса
export const getDerivatives = async (coinId: string): Promise<Derivatives> => {
    const response = await api.get<Derivatives>(`/derivatives/${coinId}`);
    return response.data;
};

// Ряд OI трёх бирж и цена спота за 30 дней с шагом step (TASK-0008).
// Неизвестная монета или шаг — 400; отказ биржи — в её поле
export const getOpenInterestHistory = async (
    coinId: string,
    step: OiStep,
): Promise<OpenInterestHistory> => {
    const response = await api.get<OpenInterestHistory>(
        `/derivatives/${coinId}/open-interest`,
        { params: { step } },
    );
    return response.data;
};
