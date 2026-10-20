import type { Interval } from "../types/market";

// Подпись свечи по времени открытия — одна на тултип, таблицу и карточку,
// иначе одна свеча 1д выглядела бы как «19 окт.» и «закрыта 20 окт.».
// Дневная свеча — только дата: её граница — полночь UTC, «03:00» по
// местному времени человеку ничего не говорит.
export const formatCandleTime = (
  t: number,
  interval: Interval,
  withDate: boolean,
): string =>
  interval === "1d"
    ? new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
    : new Date(t).toLocaleString("ru-RU", {
        ...(withDate && { day: "numeric", month: "short" }),
        hour: "2-digit",
        minute: "2-digit",
      });
