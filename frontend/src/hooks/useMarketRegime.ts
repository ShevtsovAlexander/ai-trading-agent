import { useCallback, useEffect, useRef, useState } from "react";
import { getRegime } from "../api/market";
import { classify } from "../api/errors";
import type { LoadError } from "../api/errors";
import type { MarketRegime } from "../types/market";
import { useDelayedFlag } from "./useDelayedFlag";

// Опрос раз в 5 мин: режим меняется раз в сутки (закрытие дня 00:00 UTC),
// бэкенд держит его до закрытия следующего дня (план TASK-0011, «Поток
// данных»). Смену после полуночи блок увидит не позже чем через 5 мин.
export const REGIME_POLL_MS = 5 * 60_000;

// Режим — своей загрузкой по монете, без интервала: смена интервала его не
// перезапрашивает. Приёмы — как useCoinFields: токен запроса, данные и
// ошибка только текущей монеты, скелетон через 300 мс (TASK-0005)
export const useMarketRegime = (coinId: string) => {
  const [data, setData] = useState<MarketRegime | null>(null);
  const [error, setError] = useState<{ coinId: string; error: LoadError }>({
    coinId,
    error: null,
  });
  // Монета, на которую последний раз пришёл ответ (данные или ошибка)
  const [settled, setSettled] = useState("");
  // Поздний ответ после смены монеты или следующего опроса — мимо состояния
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++requestRef.current;
    try {
      const d = await getRegime(coinId);
      if (token !== requestRef.current) return;
      setData(d);
      setError({ coinId, error: null });
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] режим рынка не загрузился:", e);
      setError({ coinId, error: classify(e) });
    }
    setSettled(coinId);
  }, [coinId]);

  useEffect(() => {
    // Первая загрузка из микротаски, как в App (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
    const poll = setInterval(load, REGIME_POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  const shown = data && data.coinId === coinId ? data : null;
  const loading = useDelayedFlag(!shown && settled !== coinId, 300);
  return {
    data: shown,
    // Ошибка прошлой монеты к текущей не относится
    error: error.coinId === coinId ? error.error : null,
    loading,
  };
};
