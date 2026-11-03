import { useCallback, useEffect, useRef, useState } from "react";
import { getTreasury } from "../api/treasury";
import { classify } from "../api/errors";
import type { LoadError } from "../api/errors";
import type { Treasury } from "../types/treasury";
import { useDelayedFlag } from "./useDelayedFlag";

// Опрос раз в 10 мин: бэкенд держит снимок час, держания меняются с отчётами
// компаний (план TASK-0013)
export const TREASURY_POLL_MS = 10 * 60_000;

// Компании-держатели — своей загрузкой, приёмы useCoinFields: токен запроса,
// данные и ошибка только текущей монеты, скелетон через 300 мс (TASK-0005)
export const useTreasury = (coinId: string) => {
  const [data, setData] = useState<Treasury | null>(null);
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
      const d = await getTreasury(coinId);
      if (token !== requestRef.current) return;
      setData(d);
      setError({ coinId, error: null });
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] компании-держатели не загрузились:", e);
      setError({ coinId, error: classify(e) });
    }
    setSettled(coinId);
  }, [coinId]);

  useEffect(() => {
    // Первая загрузка из микротаски, как в App (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
    const poll = setInterval(load, TREASURY_POLL_MS);
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
