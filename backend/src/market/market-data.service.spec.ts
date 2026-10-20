import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import * as ti from 'technicalindicators';
import { CLOSE_MARGIN_MS, MarketDataService } from './market-data.service';
import { SeriesPoint, WARMUP } from './market.types';

const STEP = 5 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);
const TOTAL = 1000;
// «Сейчас» — минута внутри свечи 900: последняя закрытая — 899
const NOW = T0 + 900 * STEP + 60_000;
const LAST = 899;
const COUNT_24H = 288;

// Цены порядка BTC с волной и шумом-синусом: у RSI/MACD/BB есть и рост, и
// падение. Детерминированно — эталон считается по тем же числам.
const closeAt = (i: number) =>
  parseFloat(
    (80000 + 2000 * Math.sin(i * 0.03) + 300 * Math.sin(i * 0.7)).toFixed(2),
  );

// Ряд в формате klines: [openTime, open, high, low, close, volume, closeTime]
const klines = (
  t0: number,
  step: number,
  total: number,
  close: (i: number) => number,
): unknown[][] =>
  Array.from({ length: total }, (_, i) => [
    t0 + i * step,
    String(close(i) - 10),
    String(close(i) + 50),
    String(close(i) - 50),
    String(close(i)),
    '1',
    t0 + (i + 1) * step - 1,
  ]);

const ROWS = klines(T0, STEP, TOTAL, closeAt);

interface KlinesParams {
  startTime: number;
  endTime: number;
  limit: number;
}

// Фейк применяет startTime/endTime/limit как Binance (см. klines.spec.ts);
// rowsUpTo — индекс последней свечи, которую «биржа» уже отдаёт.
const fakeHttp = ({ fail = false, rows = ROWS, rowsUpTo = TOTAL - 1 } = {}) => {
  const calls: KlinesParams[] = [];
  const http = {
    get: (_url: string, { params }: { params: KlinesParams }) => {
      calls.push(params);
      if (fail) return throwError(() => new Error('ECONNREFUSED'));
      const data = rows
        .slice(0, rowsUpTo + 1)
        .filter(
          (k) =>
            (k[0] as number) >= params.startTime &&
            (k[0] as number) <= params.endTime,
        )
        .slice(0, params.limit);
      return of({ data });
    },
  };
  return { http: http as unknown as HttpService, calls };
};

const makeService = (
  opts?: Parameters<typeof fakeHttp>[0] & { start?: number },
) => {
  const { http, calls } = fakeHttp(opts);
  const service = new MarketDataService(http);
  let now = opts?.start ?? NOW;
  service.clock = () => now;
  return { service, calls, advance: (ms: number) => (now += ms) };
};

// Эталон technicalindicators отдаёт компактный массив — разворачиваем в
// длину closes с NaN-префиксом, чтобы сравнивать по индексу свечи
const pad = (values: number[], length: number) => [
  ...new Array<number>(length - values.length).fill(NaN),
  ...values,
];

const TOLERANCE = 0.01; // наши значения округлены до 2 знаков

describe('MarketDataService', () => {
  it('getSeries 24h×5m: 288 свечей, разогрев не утёк, все поля = technicalindicators на тех же close', async () => {
    const { service } = makeService();
    const result = await service.getSeries('bitcoin', '5m', '24h');

    expect(result.market).toBe('BTC/USDT');
    expect(result.candles).toHaveLength(COUNT_24H);
    expect(result.series).toHaveLength(result.candles.length);
    expect(result.candles[0].t).toBe(T0 + (LAST - COUNT_24H + 1) * STEP);
    expect(result.candles[COUNT_24H - 1].t).toBe(T0 + LAST * STEP);
    result.series.forEach((p, i) => expect(p.t).toBe(result.candles[i].t));

    // Эталон — на close с разогревом, как и у сервиса
    const first = LAST - COUNT_24H + 1 - WARMUP;
    const closes = Array.from({ length: LAST - first + 1 }, (_, i) =>
      closeAt(first + i),
    );
    const n = closes.length;
    const macd = ti.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const bb = ti.BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2,
    });
    const expected: Record<Exclude<keyof SeriesPoint, 't'>, number[]> = {
      close: closes,
      ema9: pad(ti.EMA.calculate({ period: 9, values: closes }), n),
      ema21: pad(ti.EMA.calculate({ period: 21, values: closes }), n),
      rsi: pad(ti.RSI.calculate({ period: 14, values: closes }), n),
      macd: pad(
        macd.map((r) => r.MACD ?? NaN),
        n,
      ),
      macdSignal: pad(
        macd.map((r) => r.signal ?? NaN),
        n,
      ),
      macdHistogram: pad(
        macd.map((r) => r.histogram ?? NaN),
        n,
      ),
      bbUpper: pad(
        bb.map((r) => r.upper),
        n,
      ),
      bbMiddle: pad(
        bb.map((r) => r.middle),
        n,
      ),
      bbLower: pad(
        bb.map((r) => r.lower),
        n,
      ),
      bbBandwidth: pad(
        bb.map((r) => ((r.upper - r.lower) / r.middle) * 100),
        n,
      ),
    };

    const discrepancies: string[] = [];
    result.series.forEach((point, j) => {
      const i = WARMUP + j; // индекс свечи в closes эталона
      for (const [field, values] of Object.entries(expected)) {
        const mine = point[field as keyof SeriesPoint];
        const ref = values[i];
        if (mine === null || Math.abs(mine - ref) > TOLERANCE) {
          discrepancies.push(`${field}[${j}]: mine=${mine} ti=${ref}`);
        }
      }
    });

    expect(discrepancies.slice(0, 10)).toEqual([]);
  });

  it('кэш: повторный вызов внутри свечи — 0 запросов; после закрытия следующей — новый', async () => {
    const { service, calls, advance } = makeService();
    const first = await service.getSeries('bitcoin', '5m', '24h');
    const fetched = calls.length;
    expect(fetched).toBeGreaterThan(0);

    // последняя миллисекунда до «закрытия» свечи 900 с запасом на часы
    advance(STEP - 60_000 + CLOSE_MARGIN_MS - 1);
    const second = await service.getSeries('bitcoin', '5m', '24h');
    expect(calls.length).toBe(fetched);
    expect(second).toEqual(first);

    advance(1); // свеча 900 закрылась CLOSE_MARGIN_MS назад
    const third = await service.getSeries('bitcoin', '5m', '24h');
    expect(calls.length).toBeGreaterThan(fetched);
    expect(third.candles[COUNT_24H - 1].t).toBe(T0 + (LAST + 1) * STEP);
    expect(third.candles).toHaveLength(COUNT_24H);
  });

  // Момент — числом, не через CLOSE_MARGIN_MS: иначе тест подстраивался бы
  // под константу и не заметил бы, что запаса нет (мутант «запас = 0»)
  it('свеча 899 закрылась 1 с назад — ещё не в ряду (запас на часы)', async () => {
    const { service } = makeService({ start: T0 + 900 * STEP + 1000 });
    const { candles } = await service.getSeries('bitcoin', '5m', '24h');
    expect(candles[candles.length - 1].t).toBe(T0 + 898 * STEP);
  });

  it('Binance ещё не отдал только что закрытую свечу — результат не кэшируется', async () => {
    const { service, calls } = makeService({ rowsUpTo: LAST - 1 });
    await service.getSeries('bitcoin', '5m', '24h');
    const fetched = calls.length;
    await service.getSeries('bitcoin', '5m', '24h');
    expect(calls.length).toBe(2 * fetched);
  });

  it('getView: latest = последняя точка getSeries, recent — 5 последних, ma5 = ti.SMA', async () => {
    const { service } = makeService();
    const view = await service.getView('bitcoin', '5m');
    const { series } = await service.getSeries('bitcoin', '5m', '24h');

    expect(view.latest).toEqual(series[series.length - 1]);
    expect(view.recent).toEqual(series.slice(-5));
    expect(view.price).toBe(closeAt(LAST));
    expect(view.previousPrice).toBe(closeAt(LAST - 1));
    expect(view.closedAt).toBe(T0 + (LAST + 1) * STEP - 1);
    expect(view.aiComment).toBeNull();

    const last5 = Array.from({ length: 5 }, (_, i) => closeAt(LAST - 4 + i));
    const [sma] = ti.SMA.calculate({ period: 5, values: last5 });
    expect(Math.abs((view.ma5 as number) - sma)).toBeLessThanOrEqual(0.005);
  });

  // Остаток затравки = вес × её ошибка: на дневках с ценой в миллионы
  // ошибка EMA26 огромна, и при коротком разогреве карточка (свои 10 свечей)
  // расходилась бы с последней точкой графика за год
  it('1d, крупные цены: getView().latest = последняя точка getSeries за год — от старта разогрева не зависит', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const total = 2000;
    const rows = klines(T0, DAY, total, (i) =>
      parseFloat(
        (
          2_000_000 +
          1000 * i +
          500_000 * Math.sin(i * 0.02) +
          80_000 * Math.sin(i * 0.3)
        ).toFixed(2),
      ),
    );
    const { service } = makeService({
      rows,
      rowsUpTo: total - 1,
      start: T0 + 1900 * DAY + 60 * 60 * 1000,
    });

    const view = await service.getView('bitcoin', '1d');
    const { series } = await service.getSeries('bitcoin', '1d', '1y');

    expect(view.latest.t).toBe(T0 + 1899 * DAY);
    expect(view.latest).toEqual(series[series.length - 1]);
  });

  it('недопустимые комбинация, интервал, монета — 400 без обращения к Binance', async () => {
    const { service, calls } = makeService();
    await expect(service.getSeries('bitcoin', '5m', '3m')).rejects.toThrow(
      BadRequestException,
    );
    // диапазон короче MIN_CANDLES свечей: 4 часа на 1h — 4 свечи
    await expect(service.getSeries('bitcoin', '1h', '4h')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getSeries('bitcoin', '2m', '24h')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getView('dogecoin', '5m')).rejects.toThrow(
      BadRequestException,
    );
    expect(calls).toHaveLength(0);
  });

  it('Binance недоступен — 502', async () => {
    const { service } = makeService({ fail: true });
    await expect(service.getSeries('bitcoin', '5m', '24h')).rejects.toThrow(
      BadGatewayException,
    );
  });
});
