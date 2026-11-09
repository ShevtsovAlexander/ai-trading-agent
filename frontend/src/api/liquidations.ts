import { api } from './client';
import type { LiqPeriod, Liquidations } from '../types/liquidations';

// Ликвидации монеты за период (TASK-0015). Неизвестная монета или период —
// 400; нет ключа и отказ Coinalyze — 502 с текстом; нет биржи — в её поле
export const getLiquidations = async (
    coinId: string,
    period: LiqPeriod,
): Promise<Liquidations> => {
    const response = await api.get<Liquidations>(`/liquidations/${coinId}`, {
        params: { period },
    });
    return response.data;
};
