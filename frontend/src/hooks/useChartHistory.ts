import { useCallback, useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { getHistory } from "../api/market";
import { adjoins, evicted } from "../components/chartData";
import type { HistoryChunk, Interval, MarketSeries, Range } from "../types/market";

// Потолок баров в браузере (замер T1, решение человека 2026-10-22): 100 тыс.
// — setData ≈ 0,2 с, куча ≈ 180 МБ; 1 млн — секунды и ≈ 1,8 ГБ
export const MAX_BARS = 100_000;
// Пауза перед повтором куска: 429 — ограничитель запросов бэкенда держится
// до конца минуты;
// 502 и нет связи — короткая, чтобы у края не слать запрос за запросом
const LIMIT_PAUSE_MS = 60_000;
const ERROR_PAUSE_MS = 5_000;

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
  retryAt: number; // мс; раньше — loadMore не шлёт запрос (после ошибки)
}

const fresh = (key: string, epoch: number, seen: MarketSeries | null): State => ({
  key,
  epoch,
  seen,
  chunks: [],
  loading: false,
  error: null,
  complete: false,
  retryAt: 0,
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
  // Последний запрошенный кусок поколения. Каждый следующий строго левее,
  // так что before не левее запрошенного — дубль, в пути ли запрос или уже
  // ответил: ответ приходит раньше ререндера, и событие края между ними
  // зовёт loadMore прошлого рендера с прежним before (дубль в T6).
  // Ошибка запись снимает — повтор 502/429 возможен
  const lastRef = useRef<{ epoch: number; before: number } | null>(null);

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
  const { epoch, loading, complete, retryAt } = s;

  // before — t самой ранней показанной свечи
  const loadMore = useCallback(
    (before: number) => {
      const last = lastRef.current;
      if (loading || complete || capped || Date.now() < retryAt) return;
      if (last && last.epoch === epoch && before >= last.before) return;
      lastRef.current = { epoch, before };
      setState((st) => (st.epoch === epoch ? { ...st, loading: true, error: null } : st));
      getHistory(coinId, interval, before).then(
        (chunk) => {
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
          const cur = lastRef.current;
          if (cur && cur.epoch === epoch && cur.before === before) lastRef.current = null;
          console.warn("[dashboard] история не загрузилась:", e);
          const limited = isAxiosError(e) && e.response?.status === 429;
          setState((st) =>
            st.epoch === epoch
              ? {
                  ...st,
                  loading: false,
                  error: errorText(e),
                  retryAt: Date.now() + (limited ? LIMIT_PAUSE_MS : ERROR_PAUSE_MS),
                }
              : st,
          );
        },
      );
    },
    [coinId, interval, epoch, loading, complete, capped, retryAt],
  );

  // Конец паузы — новый loadMore: график перепроверит край и повторит сам,
  // если вид всё ещё у края (у предела прокрутки событий диапазона нет).
  // Ошибка снимается вместе с паузой: ушли от края — повтора нет, и метка
  // не висит над свежими свечами (критик T8)
  useEffect(() => {
    const wait = retryAt - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(
      () => setState((st) => (st.epoch === epoch && st.retryAt === retryAt ? { ...st, retryAt: 0, error: null } : st)),
      wait,
    );
    return () => clearTimeout(timer);
  }, [epoch, retryAt]);

  return { chunks: s.chunks, loading, error: s.error, complete, capped, loadMore };
};
