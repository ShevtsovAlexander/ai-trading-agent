import { useCallback, useEffect, useRef, useState } from "react";
import { getCoinFields } from "../api/coin";
import { classify } from "../api/errors";
import type { LoadError } from "../api/errors";
import type { CoinFields } from "../types/coin";
import { useDelayedFlag } from "./useDelayedFlag";

// Опрос раз в минуту: бэкенд держит снимок CoinGecko 60 с, чаще новых
// данных не будет (план TASK-0010, «Поток данных»)
export const COIN_POLL_MS = 60_000;

// Поля монеты — своей загрузкой, теми же приёмами, что useDerivatives:
// токен запроса, данные и ошибка только текущей монеты, скелетон через
// 300 мс (TASK-0005)
export const useCoinFields = (coinId: string) => {
  const [data, setData] = useState<CoinFields | null>(null);
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
      const d = await getCoinFields(coinId);
      if (token !== requestRef.current) return;
      setData(d);
      setError({ coinId, error: null });
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] поля монеты не загрузились:", e);
      setError({ coinId, error: classify(e) });
    }
    setSettled(coinId);
  }, [coinId]);

  useEffect(() => {
    // Первая загрузка из микротаски, как в App (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
    const poll = setInterval(load, COIN_POLL_MS);
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
