import { useCallback, useEffect, useRef, useState } from "react";
import { getLiquidations } from "../api/liquidations";
import { classify } from "../api/errors";
import type { LoadError } from "../api/errors";
import type { LiqPeriod, Liquidations } from "../types/liquidations";
import { useDelayedFlag } from "./useDelayedFlag";

// Раз в 5 мин: самый короткий шаг — 15 мин, бэкенд держит ряд до закрытия
// следующей свечи + минута (план TASK-0015, «Поток данных»)
export const LIQUIDATIONS_POLL_MS = 300_000;

// Ликвидации выбранного периода — приёмы useOpenInterestHistory: токен запроса,
// данные и ошибка только текущих монеты и периода, скелетон через 300 мс
export const useLiquidations = (coinId: string, period: LiqPeriod) => {
  const key = `${coinId}|${period}`;
  const [data, setData] = useState<Liquidations | null>(null);
  const [error, setError] = useState<{ key: string; error: LoadError }>({
    key,
    error: null,
  });
  // Монета и период, на которые последний раз пришёл ответ (данные или ошибка)
  const [settled, setSettled] = useState("");
  // Поздний ответ после смены монеты, периода или следующего опроса — мимо
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++requestRef.current;
    const k = `${coinId}|${period}`;
    try {
      const d = await getLiquidations(coinId, period);
      if (token !== requestRef.current) return;
      setData(d);
      setError({ key: k, error: null });
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] ликвидации не загрузились:", e);
      setError({ key: k, error: classify(e) });
    }
    setSettled(k);
  }, [coinId, period]);

  useEffect(() => {
    // Первая загрузка из микротаски, как в App (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
    const poll = setInterval(load, LIQUIDATIONS_POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  const shown =
    data && data.coinId === coinId && data.period === period ? data : null;
  const loading = useDelayedFlag(!shown && settled !== key, 300);
  return {
    data: shown,
    // Ошибка прошлых монеты или периода к текущим не относится
    error: error.key === key ? error.error : null,
    loading,
  };
};
