import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { atLeast, num } from '../derivatives/sources';
import { BOOK_DEPTH, Book, Level } from './orderbook.types';

const BINANCE_DEPTH = 'https://api.binance.com/api/v3/depth';
const OKX_BOOKS_FULL = 'https://www.okx.com/api/v5/market/books-full';

// Стаканы спота двух бирж. Как derivatives/sources.ts: свободные функции с
// HttpService аргументом, ошибки сети не ловят — их переводит в ответ
// вызывающий. Разбор строгий: цена > 0, объём ≥ 0, порядок уровней — иначе
// Error с именем биржи. OKX сообщает об ошибке в теле при HTTP 200 (code
// 51001 на неизвестный инструмент, фикстура errors) — код проверяется.
// Вес Binance depth limit=5000 — 250 (замер research TASK-0009).

const get = async <T>(
  http: HttpService,
  url: string,
  params: Record<string, string | number>,
): Promise<T> => (await firstValueFrom(http.get<T>(url, { params }))).data;

// Сторона стакана: массив [цена, объём, …] строками → Level[]. Порядок —
// строго от лучшей цены вглубь (покупки убывают, продажи растут): на нём
// держатся край охвата и разделение сторон в сборке (план, «Сборка»)
const side = (src: string, name: 'bids' | 'asks', raw: unknown): Level[] => {
  if (!Array.isArray(raw)) throw new Error(`${src}: ${name} не массив`);
  const levels: Level[] = raw.map((row: unknown, i) => {
    if (!Array.isArray(row) || row.length < 2) {
      throw new Error(`${src}: ${name}[${i}] не уровень`);
    }
    const r = row as unknown[];
    return [
      atLeast(
        src,
        `${name}[${i}] цена`,
        num(src, `${name}[${i}] цена`, r[0]),
        0,
        true,
      ),
      atLeast(
        src,
        `${name}[${i}] объём`,
        num(src, `${name}[${i}] объём`, r[1]),
        0,
        false,
      ),
    ];
  });
  for (let i = 1; i < levels.length; i++) {
    const ok =
      name === 'bids'
        ? levels[i][0] < levels[i - 1][0]
        : levels[i][0] > levels[i - 1][0];
    if (!ok) throw new Error(`${src}: ${name}[${i}] нарушен порядок цен`);
  }
  return levels;
};

const book = (
  src: string,
  raw: { bids?: unknown; asks?: unknown },
  at: number,
): Book => {
  const bids = side(src, 'bids', raw.bids);
  const asks = side(src, 'asks', raw.asks);
  if (bids.length === 0 || asks.length === 0) {
    throw new Error(`${src}: пустая сторона стакана`);
  }
  return {
    bids,
    asks,
    full: { bid: bids.length < BOOK_DEPTH, ask: asks.length < BOOK_DEPTH },
    at,
  };
};

// Binance на неизвестный символ отвечает HTTP 400 — axios бросает сам.
// Время снимка — часы бэкенда сразу после ответа (в depth времени нет);
// clock — параметром, чтобы тест подменил часы (критик T1)
export async function fetchDepthBinance(
  http: HttpService,
  symbol: string,
  clock: () => number = Date.now,
): Promise<Book> {
  const d = await get<{ bids?: unknown; asks?: unknown }>(http, BINANCE_DEPTH, {
    symbol,
    limit: BOOK_DEPTH,
  });
  return book(`Binance depth ${symbol}`, d ?? {}, clock());
}

export async function fetchBookOkx(
  http: HttpService,
  instId: string,
): Promise<Book> {
  const d = await get<{ code?: unknown; msg?: unknown; data?: unknown }>(
    http,
    OKX_BOOKS_FULL,
    { instId, sz: BOOK_DEPTH },
  );
  const src = `OKX books-full ${instId}`;
  if (d.code !== '0') {
    throw new Error(`${src}: код ${String(d.code)} — ${String(d.msg)}`);
  }
  const row = Array.isArray(d.data)
    ? (d.data[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!row) throw new Error(`${src}: нет данных`);
  const ts = num(src, 'ts', row.ts);
  if (!Number.isSafeInteger(ts) || ts <= 0) {
    throw new Error(`${src}: поле ts не время (${String(row.ts)})`);
  }
  return book(src, row, ts);
}
