import { useCallback, useEffect, useRef, useState } from "react";
import { getDerivatives } from "../api/derivatives";
import { classify } from "../api/errors";
import type { LoadError } from "../api/errors";
import type { Derivatives } from "../types/derivatives";
import { useDelayedFlag } from "./useDelayedFlag";

// Опрос раз в минуту — без привязки к интервалу свечи: funding и OI от него
// не зависят (план TASK-0007, trade-off 5); бэкенд держит снимок 30 с
export const DERIVATIVES_POLL_MS = 60_000;

// Деривативы монеты — своей загрузкой, не через load() в App: общий
// settled связал бы скелетон графика и карточки с деривативами (research
// TASK-0007, «Дальние связи»). Те же приёмы, что в App: токен запроса,
// данные только текущей монеты, скелетон с задержкой 300 мс (TASK-0005).
export const useDerivatives = (coinId: string) => {
  const [data, setData] = useState<Derivatives | null>(null);
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
      const d = await getDerivatives(coinId);
      if (token !== requestRef.current) return;
      setData(d);
      setError({ coinId, error: null });
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] деривативы не загрузились:", e);
      setError({ coinId, error: classify(e) });
    }
    setSettled(coinId);
  }, [coinId]);

  useEffect(() => {
    // Первая загрузка из микротаски, как в App (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
    const poll = setInterval(load, DERIVATIVES_POLL_MS);
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
