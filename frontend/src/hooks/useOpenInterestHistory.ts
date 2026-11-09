import { useCallback, useEffect, useRef, useState } from "react";
import { getOpenInterestHistory } from "../api/derivatives";
import { classify } from "../api/errors";
import type { LoadError } from "../api/errors";
import type { OiPeriod, OiStep, OpenInterestHistory } from "../types/derivatives";
import { useDelayedFlag } from "./useDelayedFlag";

// Раз в 5 мин: бэкенд держит полный ряд до следующего момента + 10 мин,
// неполный — 60 с (план TASK-0008, п. 9); чаще опрашивать незачем
export const OI_HISTORY_POLL_MS = 300_000;

// История OI выбранных периода и шага — своей загрузкой, как useDerivatives:
// токен запроса, данные и ошибка только текущих монеты, периода и шага,
// скелетон через 300 мс. Грузится только выбранное — почасовых и длинных
// запросов нет, пока их не выбрали (план TASK-0008, решение 5; TASK-0017).
// На 1y / all шаг — всегда 1d (его передаёт App)
export const useOpenInterestHistory = (coinId: string, period: OiPeriod, step: OiStep) => {
  const key = `${coinId}|${period}|${step}`;
  const [data, setData] = useState<OpenInterestHistory | null>(null);
  // Задан ли ключ Coinalyze — из последнего ответа любого периода; до первого
  // ответа неизвестно (null), кнопки не гасятся
  const [longAvailable, setLongAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<{ key: string; error: LoadError }>({
    key,
    error: null,
  });
  // Монета и шаг, на которые последний раз пришёл ответ (данные или ошибка)
  const [settled, setSettled] = useState("");
  // Поздний ответ после смены монеты, шага или следующего опроса — мимо
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++requestRef.current;
    const k = `${coinId}|${period}|${step}`;
    try {
      const d = await getOpenInterestHistory(coinId, period, step);
      if (token !== requestRef.current) return;
      setData(d);
      setLongAvailable(d.longAvailable);
      setError({ key: k, error: null });
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] история OI не загрузилась:", e);
      setError({ key: k, error: classify(e) });
    }
    setSettled(k);
  }, [coinId, period, step]);

  useEffect(() => {
    // Первая загрузка из микротаски, как в App (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
    const poll = setInterval(load, OI_HISTORY_POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  const shown =
    data && data.coinId === coinId && data.period === period && data.step === step ? data : null;
  const loading = useDelayedFlag(!shown && settled !== key, 300);
  return {
    data: shown,
    // Ошибка прошлых монеты или шага к текущим не относится
    error: error.key === key ? error.error : null,
    loading,
    longAvailable,
  };
};
