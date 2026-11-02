import { useCallback, useEffect, useRef, useState } from "react";
import { getOrderBook } from "../api/orderbook";
import { classify } from "../api/errors";
import type { LoadError } from "../api/errors";
import type { OrderBookSnapshot } from "../types/orderbook";

// Опрос раз в 20 с (план TASK-0009, trade-off 5; 10 с отклонено — вес
// Binance ×2); бэкенд держит снимок 15 с
export const ORDERBOOK_POLL_MS = 20_000;

// Стакан монеты — своей загрузкой, как useDerivatives: токен запроса,
// данные и ошибка только текущей монеты. Скелетона нет — полосы просто
// появляются (tasklist TASK-0009.5): график под ними уже есть.
export const useOrderBook = (coinId: string) => {
  const [data, setData] = useState<OrderBookSnapshot | null>(null);
  const [error, setError] = useState<{ coinId: string; error: LoadError }>({
    coinId,
    error: null,
  });
  // Поздний ответ после смены монеты или следующего опроса — мимо состояния
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++requestRef.current;
    try {
      const d = await getOrderBook(coinId);
      if (token !== requestRef.current) return;
      setData(d);
      setError({ coinId, error: null });
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] стакан не загрузился:", e);
      setError({ coinId, error: classify(e) });
    }
  }, [coinId]);

  useEffect(() => {
    // Первая загрузка из микротаски, как в App (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
    const poll = setInterval(load, ORDERBOOK_POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  return {
    // Снимок прошлой монеты к текущей не относится — полос нет до ответа
    data: data && data.coinId === coinId ? data : null,
    error: error.coinId === coinId ? error.error : null,
  };
};
