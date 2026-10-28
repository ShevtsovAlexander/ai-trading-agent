import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { FundingPayment } from './derivatives.types';

const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1';
const OKX_OPEN_INTEREST = 'https://www.okx.com/api/v5/public/open-interest';
const BYBIT_TICKERS = 'https://api.bybit.com/v5/market/tickers';
const HISTORY_PAGE = 1000; // максимум fundingRate за запрос
const REQUEST_DELAY_MS = 200;
// История OI (TASK-0008): у каждой биржи свой путь и свой размер страницы
const BINANCE_OI_HISTORY =
  'https://fapi.binance.com/futures/data/openInterestHist';
const OKX_OI_HISTORY =
  'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history';
const BYBIT_OI_HISTORY = 'https://api.bybit.com/v5/market/open-interest';
const BYBIT_MARK_KLINE = 'https://api.bybit.com/v5/market/mark-price-kline';
const OI_PAGE = { binance: 500, okx: 100, bybit: 200 };
const MARK_PAGE = 1000; // 31 день часовых свечей — 744, одна страница

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

// --- История OI (TASK-0008) ---
// Метка t — как у биржи, без сдвигов: что она значит (снимок в t у Binance и
// Bybit, значение в t + шаг у OKX), решает сборка ряда (research TASK-0008,
// «Дозамер»). Строки — с t ≥ from, по возрастанию; пустой итог — ошибка
// (Binance на неизвестный символ отвечает [] без кода, фикстура errors).
export interface OiRow {
  t: number;
  usd?: number; // Binance, OKX — USD по своей цене снимка
  coin?: number; // Bybit — в монетах, USD в истории нет
}

const sinceAsc = (src: string, rows: OiRow[], from: number): OiRow[] => {
  const result = rows.filter((r) => r.t >= from).sort((a, b) => a.t - b.t);
  if (result.length === 0) throw new Error(`${src}: нет данных`);
  return result;
};

const pause = () => new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

// Binance листается только назад по endTime (включительно): startTime не
// задаёт начало выдачи, а старше 30 дней — ошибка -1130 (research TASK-0008)
export async function fetchOiHistoryBinance(
  http: HttpService,
  symbol: string,
  period: '1d' | '1h',
  from: number,
): Promise<OiRow[]> {
  const src = `Binance openInterestHist ${symbol}`;
  const rows: OiRow[] = [];
  let end: number | null = null;

  for (;;) {
    const batch = await get<unknown>(http, BINANCE_OI_HISTORY, {
      symbol,
      period,
      limit: OI_PAGE.binance,
      ...(end === null ? {} : { endTime: end }),
    });
    if (!Array.isArray(batch)) {
      const e = batch as { code?: unknown; msg?: unknown } | null;
      throw new Error(`${src}: код ${String(e?.code)} — ${String(e?.msg)}`);
    }
    if (batch.length === 0) break;

    const page = (batch as Record<string, unknown>[]).map((p) => ({
      t: ms(src, 'timestamp', p.timestamp),
      usd: atLeast(
        src,
        'sumOpenInterestValue',
        num(src, 'sumOpenInterestValue', p.sumOpenInterestValue),
        0,
        false,
      ),
    }));
    const ts = page.map((p) => p.t);
    // Страница обязана уйти левее endTime — иначе цикл бьёт в биржу вечно
    if (end !== null && Math.max(...ts) > end) {
      throw new Error(`${src}: страница не сдвинулась`);
    }
    rows.push(...page);
    const oldest = Math.min(...ts);
    if (batch.length < OI_PAGE.binance || oldest < from) break;
    end = oldest - 1;
    await pause();
  }
  return sinceAsc(src, rows, from);
}

// OKX: строки [ts, контракты, монеты, USD], новые первыми; end — строго
// раньше (исключительно). Ошибка — code в теле при HTTP 200
export async function fetchOiHistoryOkx(
  http: HttpService,
  instId: string,
  period: '1Dutc' | '1H',
  from: number,
): Promise<OiRow[]> {
  const src = `OKX open-interest-history ${instId}`;
  const rows: OiRow[] = [];
  let end: number | null = null;

  for (;;) {
    const d = await get<{ code?: unknown; msg?: unknown; data?: unknown }>(
      http,
      OKX_OI_HISTORY,
      {
        instId,
        period,
        limit: OI_PAGE.okx,
        ...(end === null ? {} : { end }),
      },
    );
    if (d.code !== '0') {
      throw new Error(`${src}: код ${String(d.code)} — ${String(d.msg)}`);
    }
    if (!Array.isArray(d.data)) throw new Error(`${src}: нет данных`);
    if (d.data.length === 0) break;

    const page = (d.data as unknown[]).map((row) => {
      if (!Array.isArray(row)) throw new Error(`${src}: строка не массив`);
      return {
        t: ms(src, 'ts', row[0]),
        usd: atLeast(src, 'oiUsd', num(src, 'oiUsd', row[3]), 0, false),
      };
    });
    const ts = page.map((p) => p.t);
    if (end !== null && Math.max(...ts) >= end) {
      throw new Error(`${src}: страница не сдвинулась`);
    }
    rows.push(...page);
    const oldest = Math.min(...ts);
    if (d.data.length < OI_PAGE.okx || oldest < from) break;
    end = oldest;
    await pause();
  }
  return sinceAsc(src, rows, from);
}

// Bybit: { openInterest (монеты), timestamp }, новые первыми, дальше —
// по nextPageCursor. Ошибка — retCode в теле при HTTP 200
export async function fetchOiHistoryBybit(
  http: HttpService,
  symbol: string,
  interval: '1d' | '1h',
  from: number,
): Promise<OiRow[]> {
  const src = `Bybit open-interest ${symbol}`;
  const rows: OiRow[] = [];
  let cursor: string | null = null;
  let prevOldest = Infinity;

  // Тип d — аннотацией, не только get<Page>: cursor берётся из прошлого
  // ответа, и без неё eslint (typescript-eslint) видит d как any — 5 ошибок
  // no-unsafe-*; tsc проходит и так (проверено, критик T1)
  type Page = {
    retCode?: unknown;
    retMsg?: unknown;
    result?: { list?: unknown; nextPageCursor?: unknown };
  };
  for (;;) {
    const d: Page = await get<Page>(http, BYBIT_OI_HISTORY, {
      category: 'linear',
      symbol,
      intervalTime: interval,
      limit: OI_PAGE.bybit,
      ...(cursor === null ? {} : { cursor }),
    });
    if (d.retCode !== 0) {
      throw new Error(`${src}: код ${String(d.retCode)} — ${String(d.retMsg)}`);
    }
    const list = d.result?.list;
    if (!Array.isArray(list)) throw new Error(`${src}: нет данных`);
    if (list.length === 0) break;

    const page = (list as Record<string, unknown>[]).map((p) => ({
      t: ms(src, 'timestamp', p.timestamp),
      coin: atLeast(
        src,
        'openInterest',
        num(src, 'openInterest', p.openInterest),
        0,
        false,
      ),
    }));
    const ts = page.map((p) => p.t);
    if (Math.max(...ts) >= prevOldest) {
      throw new Error(`${src}: страница не сдвинулась`);
    }
    rows.push(...page);
    prevOldest = Math.min(...ts);
    const next = d.result?.nextPageCursor;
    if (typeof next !== 'string' || next === '' || prevOldest < from) break;
    cursor = next;
    await pause();
  }
  return sinceAsc(src, rows, from);
}

// Mark-цена Bybit: open свечи, начатой в t, — цена в момент t; ею Bybit OI
// переводится в USD, как Binance и OKX переводят своей ценой (research
// TASK-0008, «Дозамер»). Строки [start, open, high, low, close], новые
// первыми. Одна страница: полная — значит, окно обрезано, это ошибка.
export async function fetchMarkBybit(
  http: HttpService,
  symbol: string,
  interval: 'D' | '60',
  from: number,
  to: number,
): Promise<Map<number, number>> {
  const src = `Bybit mark-price-kline ${symbol}`;
  const d = await get<{
    retCode?: unknown;
    retMsg?: unknown;
    result?: { list?: unknown };
  }>(http, BYBIT_MARK_KLINE, {
    category: 'linear',
    symbol,
    interval,
    start: from,
    end: to,
    limit: MARK_PAGE,
  });
  if (d.retCode !== 0) {
    throw new Error(`${src}: код ${String(d.retCode)} — ${String(d.retMsg)}`);
  }
  const list = d.result?.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${src}: нет данных`);
  }
  if (list.length >= MARK_PAGE) throw new Error(`${src}: окно обрезано`);
  const marks = new Map<number, number>();
  for (const row of list as unknown[]) {
    if (!Array.isArray(row)) throw new Error(`${src}: строка не массив`);
    marks.set(
      ms(src, 'start', row[0]),
      atLeast(src, 'open', num(src, 'open', row[1]), 0, true),
    );
  }
  return marks;
}
