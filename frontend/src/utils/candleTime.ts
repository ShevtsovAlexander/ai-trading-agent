import type { Interval } from "../types/market";

// Подпись свечи по времени открытия — одна на тултип, таблицу и карточку,
// иначе одна свеча 1д выглядела бы как «19 окт.» и «закрыта 20 окт.».
// Дневная свеча — только дата: её граница — полночь UTC, «03:00» по
// местному времени человеку ничего не говорит.
// Свеча не текущего года — с годом (и датой): в глубокой истории «17 авг.»
// не говорит, какого года. Суффикс « г.» из ru-RU убран: «17 авг. 2017».
export const formatCandleTime = (
  t: number,
  interval: Interval,
  withDate: boolean,
): string => {
  const d = new Date(t);
  const year = d.getFullYear() !== new Date().getFullYear();
  const date: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    ...(year && { year: "numeric" }),
  };
  const s =
    interval === "1d"
      ? d.toLocaleDateString("ru-RU", date)
      : d.toLocaleString("ru-RU", {
          ...((withDate || year) && date),
          hour: "2-digit",
          minute: "2-digit",
        });
  return s.replace(" г.", "");
};
