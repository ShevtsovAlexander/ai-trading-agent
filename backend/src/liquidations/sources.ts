import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const HISTORY_URL = 'https://api.coinalyze.net/v1/liquidation-history';
const SOURCE = 'Coinalyze';

export interface LiqBar {
  t: number; // мс UTC
  long: number; // USD
  short: number; // USD
}

// Числа Coinalyze — числа JSON, не строки: `num` из derivatives/sources здесь
// не подходит, менять его нельзя — от него зависят стакан и деривативы
// (research TASK-0015, риск 1)
const amount = (field: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${SOURCE}: поле ${field} не сумма (${String(value)})`);
  }
  return value;
};

const seconds = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${SOURCE}: поле t не время (${String(value)})`);
  }
  return value * 1000;
};

// Ответ → ряды по символам. Символа нет в ответе — его нет и в словаре: это
// отказ одной биржи, а не всего запроса. Чужой символ или порча — ошибка
export function parseLiquidations(
  raw: unknown,
  symbols: string[],
): Map<string, LiqBar[]> {
  if (!Array.isArray(raw)) throw new Error(`${SOURCE}: ответ не массив`);
  const out = new Map<string, LiqBar[]>();
  for (const row of raw as Record<string, unknown>[]) {
    const symbol = row?.symbol;
    if (typeof symbol !== 'string' || !symbols.includes(symbol)) {
      throw new Error(`${SOURCE}: чужой символ ${String(symbol)}`);
    }
    if (!Array.isArray(row.history)) {
      throw new Error(`${SOURCE}: ${symbol} без history`);
    }
    out.set(
      symbol,
      (row.history as Record<string, unknown>[]).map((p) => ({
        t: seconds(p?.t),
        long: amount('l', p?.l),
        short: amount('s', p?.s),
      })),
    );
  }
  return out;
}

// from, to — открытия первой и последней свечи, мс; Coinalyze ждёт секунды.
// Ключ — только заголовком; ошибки сети не ловит: их переводит вызывающий
export async function fetchLiquidations(
  http: HttpService,
  key: string,
  symbols: string[],
  interval: string,
  from: number,
  to: number,
): Promise<Map<string, LiqBar[]>> {
  const res = await firstValueFrom(
    http.get<unknown>(HISTORY_URL, {
      headers: { api_key: key },
      params: {
        symbols: symbols.join(','),
        interval,
        from: from / 1000,
        to: to / 1000,
        convert_to_usd: 'true',
      },
    }),
  );
  return parseLiquidations(res.data, symbols);
}
