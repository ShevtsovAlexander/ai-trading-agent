import { useCallback, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { getHistory } from "../api/market";
import { adjoins, evicted } from "../components/chartData";
import type { HistoryChunk, Interval, MarketSeries, Range } from "../types/market";

// Потолок баров в браузере (замер T1, решение человека 2026-10-22): 100 тыс.
// — setData ≈ 0,2 с, куча ≈ 180 МБ; 1 млн — секунды и ≈ 1,8 ГБ
export const MAX_BARS = 100_000;

interface State {
  key: string; // монета|интервал|диапазон
  // Поколение истории: растёт на каждом сбросе. Ответ куска, отправленный в
  // прошлом поколении, в состояние не попадает (токен, как requestRef в App)
  epoch: number;
  seen: MarketSeries | null; // основное окно, по которому посчитаны chunks
  chunks: HistoryChunk[];
  loading: boolean;
  error: string | null;
  complete: boolean;
}

const fresh = (key: string, epoch: number, seen: MarketSeries | null): State => ({
  key,
  epoch,
  seen,
  chunks: [],
  loading: false,
  error: null,
  complete: false,
});

// 429/502 — текст бэкенда («Лимит Binance…», «Binance недоступен»)
const errorText = (e: unknown): string => {
  if (!isAxiosError(e) || !e.response) return "нет связи с бэкендом";
  const message = e.response.data?.message;
  return typeof message === "string" ? message : `код ${e.response.status}`;
};

// Куски истории левее основного окна (main = chartShown). Опрос того же
// ключа добавляет вытесненные из окна свечи (evicted) — всегда, а не только
// при загруженной истории: иначе опрос во время первой догрузки рвёт стык
// (критик T4). Окно уехало дальше своей длины (!adjoins) — сброс. Смена
// монеты, интервала или диапазона — сброс: кнопка = стартовое окно
// (PRD крит. 11).
export const useChartHistory = (
  coinId: string,
  interval: Interval,
  range: Range,
  main: MarketSeries | null,
) => {
  const key = `${coinId}|${interval}|${range}`;
  const [state, setState] = useState<State>(() => fresh(key, 0, main));
  // Поколение, у которого кусок в пути: второй вызов до ререндера не шлёт
  // второй запрос
  const busyRef = useRef(-1);

  // Состояние из прошлого рендера (паттерн React): ключ и основное окно
  // сравниваются при рендере, без setState в эффекте
  let s = state;
  if (s.key !== key) s = fresh(key, s.epoch + 1, main);
  if (main !== s.seen) {
    if (!main || !s.seen) s = { ...s, seen: main };
    else if (!adjoins(s.seen, main)) s = fresh(key, s.epoch + 1, main);
    else {
      const ev = evicted(s.seen, main);
      s = { ...s, seen: main, chunks: ev ? [...s.chunks, ev] : s.chunks };
    }
  }
  if (s !== state) setState(s);

  // Куски не пересекаются ни между собой, ни с окном — сумма точная
  const bars =
    s.chunks.reduce((n, c) => n + c.candles.length, 0) + (main?.candles.length ?? 0);
  const capped = bars >= MAX_BARS;
  const { epoch, loading, complete } = s;

  // before — t самой ранней показанной свечи
  const loadMore = useCallback(
    (before: number) => {
      if (loading || complete || capped || busyRef.current === epoch) return;
      busyRef.current = epoch;
      setState((st) => (st.epoch === epoch ? { ...st, loading: true, error: null } : st));
      getHistory(coinId, interval, before).then(
        (chunk) => {
          if (busyRef.current === epoch) busyRef.current = -1;
          setState((st) =>
            st.epoch === epoch
              ? {
                  ...st,
                  loading: false,
                  chunks: [chunk, ...st.chunks],
                  complete: chunk.complete,
                }
              : st,
          );
        },
        (e) => {
          if (busyRef.current === epoch) busyRef.current = -1;
          console.warn("[dashboard] история не загрузилась:", e);
          setState((st) =>
            st.epoch === epoch ? { ...st, loading: false, error: errorText(e) } : st,
          );
        },
      );
    },
    [coinId, interval, epoch, loading, complete, capped],
  );

  return { chunks: s.chunks, loading, error: s.error, complete, capped, loadMore };
};
