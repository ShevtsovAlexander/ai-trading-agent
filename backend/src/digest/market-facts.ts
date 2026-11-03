import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { Regime } from '../market/regime';
import type { MarketFact } from './digest.types';

// Факты рынка для свода (TASK-0012): считает код, модель только связывает их
// словами. Часовые свечи, а не дневки: свод раз в час, дневная свеча к вечеру
// устарела бы на сутки (план TASK-0012, «Подход»).

const KLINES_URL = 'https://api.binance.com/api/v3/klines';
const HOUR = 3_600_000;
// 24 ч «сейчас» + 720 ч (30 суток) перед ними — база среднего объёма
export const HOURS = 24 + 720;
// Окно запроса — 32 суток: Binance отдаёт свечи с openTime ≥ startTime,
// и 31 сутки (= 744 ч) в любую минуту часа, кроме :00, дают 743 закрытых
// (критик TASK-0012.1–3). 32 суток = 768 строк < 1000 — один запрос (вес 2).
export const WINDOW_MS = 32 * 24 * HOUR;

export interface HourCandle {
  t: number;
  close: number;
  quoteVolume: number; // объём в USDT (quoteAssetVolume, k[7])
  closeTime: number;
}

const num = (row: unknown[], i: number, field: string): number => {
  const v = row[i];
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`klines 1h: поле ${field} — не число: ${String(v)}`);
  }
  return n;
};

const int = (row: unknown[], i: number, field: string): number => {
  const v = row[i];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`klines 1h: поле ${field} — не время: ${String(v)}`);
  }
  return v;
};

// Строгий разбор ответа klines: только закрытые часы (closeTime < now).
// Свой разборщик, а не fetchClosedCandles: нужен quoteAssetVolume, а Candle
// уходит в /market/candles (план TASK-0012, trade-off 1).
export function parseHourly(data: unknown, now: number): HourCandle[] {
  if (!Array.isArray(data)) throw new Error('klines 1h: ответ не массив');
  const out: HourCandle[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 8) {
      throw new Error('klines 1h: строка не массив из 8+ полей');
    }
    const r = row as unknown[];
    const c: HourCandle = {
      t: int(r, 0, 'openTime'),
      close: num(r, 4, 'close'),
      closeTime: int(r, 6, 'closeTime'),
      quoteVolume: num(r, 7, 'quoteAssetVolume'),
    };
    if (c.closeTime < now) out.push(c);
  }
  return out;
}

export async function fetchHourly(
  http: HttpService,
  symbol: string,
  now: number,
): Promise<HourCandle[]> {
  const response = await firstValueFrom(
    http.get<unknown>(KLINES_URL, {
      params: {
        symbol,
        interval: '1h',
        startTime: now - WINDOW_MS,
        endTime: now,
        limit: 1000,
      },
    }),
  );
  return parseHourly(response.data, now);
}

const r2 = (x: number) => parseFloat(x.toFixed(2));

// Последние HOURS закрытых часов → факт. Меньше — ошибка: среднее за 30 дней
// по неполной базе было бы враньём. «24 ч назад» — по строкам, не по времени:
// дыра Binance сдвинула бы его на час (план TASK-0012, «Риски»).
export function buildFact(
  coinId: string,
  market: string,
  hours: HourCandle[],
  regime: { regime: Regime; days: number } | null,
): MarketFact {
  if (hours.length < HOURS) {
    throw new Error(`мало часовых свечей: ${hours.length} из ${HOURS}`);
  }
  const k = hours.slice(-HOURS);
  const last = k[HOURS - 1];
  const dayAgo = k[HOURS - 25];
  const volume24hUsd = k.slice(-24).reduce((s, c) => s + c.quoteVolume, 0);
  const base = k.slice(0, 720).reduce((s, c) => s + c.quoteVolume, 0) / 30;
  return {
    coinId,
    market,
    price: last.close,
    change24hPct: r2((last.close / dayAgo.close - 1) * 100),
    volume24hUsd,
    volumeRatio30d: r2(volume24hUsd / base),
    regime: regime?.regime ?? null,
    regimeDays: regime?.days ?? null,
    at: last.closeTime,
  };
}

const ru = (n: number, digits: number) =>
  n.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const REGIME_RU: Record<Regime, string> = {
  up: 'тренд вверх',
  down: 'тренд вниз',
  range: 'боковик',
};

const billions = (usd: number) =>
  usd >= 1e9 ? `${ru(usd / 1e9, 2)} млрд` : `${ru(usd / 1e6, 0)} млн`;

// Строка факта для промпта — числа уже в том виде, в каком их можно писать
// (проверка ответа сравнивает числа текста с числами промпта)
export function factLine(f: MarketFact): string {
  const ticker = f.market.split('/')[0];
  const sign = f.change24hPct > 0 ? '+' : '';
  const regime =
    f.regime === null
      ? 'режим по дневным свечам: нет данных'
      : `режим по дневным свечам: ${REGIME_RU[f.regime]}, ${f.regimeDays} дн.`;
  return (
    `${ticker}: цена ${ru(f.price, 2)} USDT; за 24 ч ${sign}${ru(f.change24hPct, 2)} %; ` +
    `объём за 24 ч ${billions(f.volume24hUsd)} USDT — ${ru(f.volumeRatio30d, 2)} ` +
    `от среднего суточного за 30 дней; ${regime}`
  );
}
