import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Candle } from '../market/market.types';

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const PAGE_SIZE = 1000; // максимум klines за запрос
const REQUEST_DELAY_MS = 200;

// Закрытые свечи symbol/interval с openTime в [startTime, endTime], по
// возрастанию времени. Постранично вперёд: следующая страница — с openTime
// последней свечи + 1. Незакрытая свеча (closeTime > now) отбрасывается:
// она ещё меняется, и индикаторы по ней дрожали бы внутри одной свечи.
// Закрытость — по локальным часам: допущение, что они не спешат
// относительно Binance (замер 2026-10-19: отстают на ~0.3 с — безопасная
// сторона). Дыры самой Binance (остановки биржи, напр. 2023-03-24, 85 мин)
// отдаём как есть, без заполнения: шаг t тогда больше интервала.
// Ошибки Binance не ловим — их переводит в ответ вызывающий.
export async function fetchClosedCandles(
  http: HttpService,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  now = Date.now(),
): Promise<Candle[]> {
  const result: Candle[] = [];
  let from = startTime;

  while (from <= endTime) {
    const response = await firstValueFrom(
      http.get<unknown[][]>(BINANCE_KLINES_URL, {
        params: {
          symbol,
          interval,
          startTime: from,
          endTime,
          limit: PAGE_SIZE,
        },
      }),
    );

    const batch = response.data;
    if (batch.length === 0) break;

    for (const k of batch) {
      if ((k[6] as number) > now) continue; // closeTime в будущем — не закрыта
      result.push({
        t: k[0] as number,
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
      });
    }

    if (batch.length < PAGE_SIZE) break;

    // Страница обязана начинаться не раньше from — иначе цикл не двигается
    // и бесконечно бьёт в Binance (поймано мутантом «фейк без startTime»)
    const lastOpen = batch[batch.length - 1][0] as number;
    if (lastOpen < from) {
      throw new Error(`klines ${symbol} ${interval}: страница не сдвинулась`);
    }
    from = lastOpen + 1;

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  return result;
}
