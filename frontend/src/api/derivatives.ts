import { api } from './client';
import type { Derivatives, OiPeriod, OiStep, OpenInterestHistory } from '../types/derivatives';

// Ставка Binance + мера необычности, OI Binance/OKX/Bybit. Неизвестная
// монета — 400; отказ биржи — в её поле, не ошибкой запроса
export const getDerivatives = async (coinId: string): Promise<Derivatives> => {
    const response = await api.get<Derivatives>(`/derivatives/${coinId}`);
    return response.data;
};

// Ряд OI трёх бирж и цена спота: 30 дней с шагом step (TASK-0008), год и «Всё» —
// по дням из Coinalyze (TASK-0017), шаг не шлётся. 400 — монета, период, шаг;
// 502 — нет ключа или отказ Coinalyze; отказ биржи — в её поле
export const getOpenInterestHistory = async (
    coinId: string,
    period: OiPeriod,
    step: OiStep,
): Promise<OpenInterestHistory> => {
    const response = await api.get<OpenInterestHistory>(
        `/derivatives/${coinId}/open-interest`,
        { params: period === '30d' ? { period, step } : { period } },
    );
    return response.data;
};
