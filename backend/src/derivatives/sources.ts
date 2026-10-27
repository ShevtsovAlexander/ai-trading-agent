import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { FundingPayment } from './derivatives.types';

const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1';
const OKX_OPEN_INTEREST = 'https://www.okx.com/api/v5/public/open-interest';
const BYBIT_TICKERS = 'https://api.bybit.com/v5/market/tickers';
const HISTORY_PAGE = 1000; // максимум fundingRate за запрос
const REQUEST_DELAY_MS = 200;

// Запросы к деривативам трёх бирж. Как klines.ts: свободные функции с
// HttpService аргументом, ошибки сети не ловят — их переводит в ответ
// вызывающий. Разбор строгий: нет поля или не конечное число — Error с
// именем биржи, а не NaN на экране (план TASK-0007, «Риски»). OKX и Bybit
// сообщают об ошибке в теле при HTTP 200 (фикстура errors) — код проверяется.

const num = (source: string, field: string, value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : NaN;
  // Number('  ') === 0 — пустую и пробельную строку отсекаем явно (критик T2)
  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(n)) {
    throw new Error(`${source}: поле ${field} не число (${String(value)})`);
  }
  return n;
};

// Объём и цена не бывают отрицательными: иначе минус молча ушёл бы в сумму
// OI (критик T2). Цена — строго > 0, объём — ≥ 0.
const atLeast = (
  source: string,
  field: string,
  n: number,
  min: number,
  strict: boolean,
): number => {
  if (strict ? n <= min : n < min) {
    throw new Error(`${source}: поле ${field} вне диапазона (${n})`);
  }
  return n;
};

const ms = (source: string, field: string, value: unknown): number => {
  const n = typeof value === 'number' ? value : num(source, field, value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${source}: поле ${field} не время (${String(value)})`);
  }
  return n;
};

const get = async <T>(
  http: HttpService,
  url: string,
  params: Record<string, string | number>,
): Promise<T> => (await firstValueFrom(http.get<T>(url, { params }))).data;

export interface FundingNow {
  rate: number; // lastFundingRate — расчётная на ближайшую выплату
  nextFundingTime: number;
  markPrice: number; // для перевода Binance OI из монет в USD
  at: number;
}

// Текущая ставка и цена маркировки Binance — один запрос на оба поля
export async function fetchFunding(
  http: HttpService,
  symbol: string,
): Promise<FundingNow> {
  const d = await get<Record<string, unknown>>(
    http,
    `${BINANCE_FAPI}/premiumIndex`,
    { symbol },
  );
  const src = `Binance premiumIndex ${symbol}`;
  return {
    rate: num(src, 'lastFundingRate', d.lastFundingRate),
    nextFundingTime: ms(src, 'nextFundingTime', d.nextFundingTime),
    markPrice: atLeast(
      src,
      'markPrice',
      num(src, 'markPrice', d.markPrice),
      0,
      true,
    ),
    at: ms(src, 'time', d.time),
  };
}

// Выплаты с fundingTime в [startTime, endTime], по возрастанию. Постранично
// вперёд от fundingTime последней + 1, как klines.ts. startTime обязателен
// и > 0: без него (и при 0) Binance отдаёт только 500 последних
// (research TASK-0007; RESEARCH.md, funding).
export async function fetchFundingHistory(
  http: HttpService,
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<FundingPayment[]> {
  if (!(startTime > 0)) {
    throw new Error(`fundingRate ${symbol}: startTime должен быть > 0`);
  }
  const src = `Binance fundingRate ${symbol}`;
  const result: FundingPayment[] = [];
  let from = startTime;

  while (from <= endTime) {
    const batch = await get<Record<string, unknown>[]>(
      http,
      `${BINANCE_FAPI}/fundingRate`,
      { symbol, startTime: from, endTime, limit: HISTORY_PAGE },
    );
    if (!Array.isArray(batch)) throw new Error(`${src}: ответ не массив`);
    if (batch.length === 0) break;

    for (const p of batch) {
      result.push({
        t: ms(src, 'fundingTime', p.fundingTime),
        rate: num(src, 'fundingRate', p.fundingRate),
      });
    }
    if (batch.length < HISTORY_PAGE) break;

    // Страница обязана сдвигаться — иначе цикл бьёт в Binance бесконечно
    const last = result[result.length - 1].t;
    if (last < from) throw new Error(`${src}: страница не сдвинулась`);
    from = last + 1;

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
  return result;
}

export interface OpenInterest {
  usd: number;
  at: number;
}

// Binance отдаёт OI в монетах — в USD по markPrice из premiumIndex
// (research TASK-0007, «единицы OI»)
export async function fetchOpenInterestBinance(
  http: HttpService,
  symbol: string,
  markPrice: number,
): Promise<OpenInterest> {
  const d = await get<Record<string, unknown>>(
    http,
    `${BINANCE_FAPI}/openInterest`,
    { symbol },
  );
  const src = `Binance openInterest ${symbol}`;
  atLeast(src, 'markPrice', markPrice, 0, true);
  return {
    usd:
      atLeast(
        src,
        'openInterest',
        num(src, 'openInterest', d.openInterest),
        0,
        false,
      ) * markPrice,
    at: ms(src, 'time', d.time),
  };
}

export async function fetchOpenInterestOkx(
  http: HttpService,
  instId: string,
): Promise<OpenInterest> {
  const d = await get<{ code?: unknown; msg?: unknown; data?: unknown }>(
    http,
    OKX_OPEN_INTEREST,
    { instType: 'SWAP', instId },
  );
  const src = `OKX open-interest ${instId}`;
  if (d.code !== '0') {
    throw new Error(`${src}: код ${String(d.code)} — ${String(d.msg)}`);
  }
  const row = Array.isArray(d.data)
    ? (d.data[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!row) throw new Error(`${src}: нет данных`);
  return {
    usd: atLeast(src, 'oiUsd', num(src, 'oiUsd', row.oiUsd), 0, false),
    at: ms(src, 'ts', row.ts),
  };
}

// OI Bybit — в tickers: openInterestValue уже в USD; время — ответа
export async function fetchOpenInterestBybit(
  http: HttpService,
  symbol: string,
): Promise<OpenInterest> {
  const d = await get<{
    retCode?: unknown;
    retMsg?: unknown;
    result?: { list?: unknown };
    time?: unknown;
  }>(http, BYBIT_TICKERS, { category: 'linear', symbol });
  const src = `Bybit tickers ${symbol}`;
  if (d.retCode !== 0) {
    throw new Error(`${src}: код ${String(d.retCode)} — ${String(d.retMsg)}`);
  }
  const list = d.result?.list;
  const row = Array.isArray(list)
    ? (list[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!row) throw new Error(`${src}: нет данных`);
  return {
    usd: atLeast(
      src,
      'openInterestValue',
      num(src, 'openInterestValue', row.openInterestValue),
      0,
      false,
    ),
    at: ms(src, 'time', d.time),
  };
}
