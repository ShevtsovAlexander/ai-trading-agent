import { isAxiosError } from "axios";

// Перенесено из App.tsx без изменений (TASK-0007.6): те же тексты ошибок
// нужны графику, карточке и панели деривативов.

// Отказ чтения — три разные причины, три разных текста: «network» — бэкенд
// не ответил; «binance» — бэкенд жив, но Binance не отдал данные (502);
// «http» — бэкенд ответил другой ошибкой (400/404/500).
export type LoadError =
  | { kind: "network" }
  | { kind: "binance"; message: string }
  | { kind: "http"; status: number }
  | null;

export const classify = (e: unknown): LoadError => {
  if (!isAxiosError(e) || !e.response) return { kind: "network" };
  const { status, data } = e.response;
  if (status === 502) {
    const message =
      typeof data?.message === "string" ? data.message : "Binance недоступен";
    return { kind: "binance", message };
  }
  return { kind: "http", status };
};

export const errorText = (e: NonNullable<LoadError>): string =>
  e.kind === "network"
    ? "Нет связи с бэкендом"
    : e.kind === "binance"
      ? e.message
      : `Бэкенд вернул ошибку (код ${e.status})`;
