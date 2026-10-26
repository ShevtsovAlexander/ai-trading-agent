import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import * as ti from 'technicalindicators';
import {
  CLOSE_MARGIN_MS,
  MarketDataService,
  WEIGHT_THROTTLE,
} from './market-data.service';
import {
  HISTORY_CHUNK,
  HistoryChunk,
  SeriesPoint,
  WARMUP,
} from './market.types';

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
// rowsUpTo — индекс последней свечи, которую «биржа» уже отдаёт; первая
// строка rows — листинг пары: левее «биржа» свечей не отдаёт.
// weight — значение заголовка x-mbx-used-weight-1m (null — без заголовка),
// failStatus — ответ ошибкой с этим HTTP-статусом, как axios.
const fakeHttp = ({
  fail = false,
  rows = ROWS,
  rowsUpTo = rows.length - 1,
  weight = 10 as number | null,
  failStatus = undefined as number | undefined,
} = {}) => {
  const calls: KlinesParams[] = [];
  const state = { weight, failStatus };
  const http = {
    get: (_url: string, { params }: { params: KlinesParams }) => {
      calls.push(params);
      if (fail) return throwError(() => new Error('ECONNREFUSED'));
      if (state.failStatus !== undefined) {
        const status = state.failStatus;
        return throwError(() =>
          Object.assign(
            new Error(`Request failed with status code ${status}`),
            {
              response: { status },
            },
          ),
        );
      }
      const data = rows
        .slice(0, rowsUpTo + 1)
        .filter(
          (k) =>
            (k[0] as number) >= params.startTime &&
            (k[0] as number) <= params.endTime,
        )
        .slice(0, params.limit);
      const headers =
        state.weight === null
          ? {}
          : { 'x-mbx-used-weight-1m': String(state.weight) };
      return of({ data, headers });
    },
  };
  return { http: http as unknown as HttpService, calls, state };
};

const makeService = (
  opts?: Parameters<typeof fakeHttp>[0] & { start?: number },
) => {
  const { http, calls, state } = fakeHttp(opts);
  const service = new MarketDataService(http);
  let now = opts?.start ?? NOW;
  service.clock = () => now;
  return { service, calls, state, advance: (ms: number) => (now += ms) };
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

  describe('getHistory', () => {
    // Длинный ряд: 5000 свечей от листинга (T0), «сейчас» внутри 4900
    const LONG_TOTAL = 5000;
    const LONG_LAST = 4899;
    const LONG_ROWS = klines(T0, STEP, LONG_TOTAL, closeAt);
    const LONG_NOW = T0 + (LONG_LAST + 1) * STEP + 60_000;
    const idx = (t: number) => (t - T0) / STEP;
    const at = (i: number) => String(T0 + i * STEP);

    const longService = (opts?: Parameters<typeof makeService>[0]) =>
      makeService({ rows: LONG_ROWS, start: LONG_NOW, ...opts });

    // Эталон — technicalindicators на ВСЕХ close от листинга: длинный ряд,
    // с которым обязан совпасть кусок, посчитанный со своим разогревом
    const longCloses = Array.from({ length: LONG_LAST + 1 }, (_, i) =>
      closeAt(i),
    );
    const n = longCloses.length;
    const macd = ti.MACD.calculate({
      values: longCloses,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const bb = ti.BollingerBands.calculate({
      period: 20,
      values: longCloses,
      stdDev: 2,
    });
    const reference: Record<Exclude<keyof SeriesPoint, 't'>, number[]> = {
      close: longCloses,
      ema9: pad(ti.EMA.calculate({ period: 9, values: longCloses }), n),
      ema21: pad(ti.EMA.calculate({ period: 21, values: longCloses }), n),
      rsi: pad(ti.RSI.calculate({ period: 14, values: longCloses }), n),
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

    // null — только там, где у эталона NaN (периоду не хватило свечей)
    const discrepancies = (series: SeriesPoint[]) => {
      const out: string[] = [];
      for (const point of series) {
        const i = idx(point.t);
        for (const [field, values] of Object.entries(reference)) {
          const mine = point[field as keyof SeriesPoint];
          const ref = values[i];
          const ok =
            mine === null
              ? Number.isNaN(ref)
              : Math.abs(mine - ref) <= TOLERANCE;
          if (!ok) out.push(`${field}[${i}]: mine=${mine} ti=${ref}`);
        }
      }
      return out;
    };

    it('4 куска назад от getSeries до листинга: ряды = длинный ряд technicalindicators, стыки без дыр и дублей', async () => {
      const { service } = longService();
      const main = await service.getSeries('bitcoin', '5m', '24h');

      let before = main.candles[0].t;
      const chunks: HistoryChunk[] = [];
      for (let k = 0; k < 4; k++) {
        const chunk = await service.getHistory('bitcoin', '5m', String(before));
        chunks.push(chunk);
        expect(chunk.before).toBe(before);
        expect(chunk.series.map((p) => p.t)).toEqual(
          chunk.candles.map((c) => c.t),
        );
        expect(discrepancies(chunk.series).slice(0, 10)).toEqual([]);
        // стык: последняя свеча куска — ровно перед before
        expect(chunk.candles[chunk.candles.length - 1].t).toBe(before - STEP);
        before = chunk.candles[0].t;
      }

      // 4612 свечей слева от основного окна: 1500 + 1500 + 1500 + 112
      expect(chunks.map((c) => c.candles.length)).toEqual([
        HISTORY_CHUNK,
        HISTORY_CHUNK,
        HISTORY_CHUNK,
        112,
      ]);
      expect(chunks.map((c) => c.complete)).toEqual([
        false,
        false,
        false,
        true,
      ]);

      // всё вместе — непрерывный ряд от листинга до конца основного окна
      const ts = [...chunks]
        .reverse()
        .flatMap((c) => c.candles.map((x) => x.t))
        .concat(main.candles.map((c) => c.t));
      expect(ts[0]).toBe(T0);
      ts.forEach((t, i) => expect(t).toBe(T0 + i * STEP));

      // начало истории: первые точки — null, как у короткого ряда
      const first = chunks[3].series[0];
      expect(first.ema9).toBeNull();
      expect(first.bbUpper).toBeNull();
    });

    // Листинг внутри зоны разогрева: кусок полный, но левее него свечи есть
    it('листинг в зоне разогрева — complete: false; кусок от листинга — complete: true', async () => {
      const { service } = longService();
      const full = await service.getHistory('bitcoin', '5m', at(1600));
      expect(full.candles).toHaveLength(HISTORY_CHUNK);
      expect(full.candles[0].t).toBe(T0 + 100 * STEP);
      expect(full.complete).toBe(false);

      const empty = await service.getHistory('bitcoin', '5m', at(0));
      expect(empty.candles).toEqual([]);
      expect(empty.complete).toBe(true);
    });

    it('before = 0 — пустой кусок без запроса и без предупреждения о весе', async () => {
      const { service, calls } = longService({ start: LONG_NOW });
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      const chunk = await service.getHistory('bitcoin', '5m', '0');
      expect(chunk.candles).toEqual([]);
      expect(chunk.complete).toBe(true);
      expect(calls).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    });

    // Сбой Binance: ответ оборвался раньше before − step
    it('усечённый ответ (нет правой свечи) — не кэшируется', async () => {
      const { service, calls } = longService({ rowsUpTo: 2900 });
      const cut = await service.getHistory('bitcoin', '5m', at(3000));
      expect(cut.candles[cut.candles.length - 1].t).toBe(T0 + 2900 * STEP);
      const fetched = calls.length;
      await service.getHistory('bitcoin', '5m', at(3000));
      expect(calls.length).toBe(2 * fetched);
    });

    it('невалидный before — 400 без обращения к Binance', async () => {
      const { service, calls } = longService();
      for (const before of [
        String(T0 + STEP + 1), // не кратен интервалу
        at(LONG_LAST + 1), // идущая свеча — не закрыта
        at(LONG_LAST + 100), // будущее
        'abc',
        '1e12',
        '-300000',
        '',
      ]) {
        await expect(
          service.getHistory('bitcoin', '5m', before),
        ).rejects.toThrow(BadRequestException);
      }
      await expect(
        service.getHistory('dogecoin', '5m', at(1600)),
      ).rejects.toThrow(BadRequestException);
      expect(calls).toHaveLength(0);
    });

    it('повторный кусок — из кэша, 0 запросов', async () => {
      const { service, calls } = longService();
      const first = await service.getHistory('bitcoin', '5m', at(3000));
      const fetched = calls.length;
      expect(fetched).toBe(2); // окно 2000 = 2 страницы по 1000
      const second = await service.getHistory('bitcoin', '5m', at(3000));
      expect(calls).toHaveLength(fetched);
      expect(second).toEqual(first);
    });

    // Вес кормит сам getHistory: основное окно не вызывается вовсе
    it(`кусок с весом ≥ ${WEIGHT_THROTTLE} — следующий кусок 429 без запроса; в новой минуте — снова пускает`, async () => {
      const { service, calls, state, advance } = longService({
        weight: WEIGHT_THROTTLE,
        start: Math.floor(LONG_NOW / 60_000) * 60_000 + 1000,
      });
      await service.getHistory('bitcoin', '5m', at(3000));
      const fetched = calls.length;

      const error = await service
        .getHistory('bitcoin', '5m', at(1500))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(calls).toHaveLength(fetched);
      // кэшированный кусок ограничитель не режет
      await service.getHistory('bitcoin', '5m', at(3000));
      expect(calls).toHaveLength(fetched);

      state.weight = 10;
      advance(60_000); // Binance обнулил вес с новой минутой
      await service.getHistory('bitcoin', '5m', at(1500));
      expect(calls.length).toBeGreaterThan(fetched);
    });

    it('вес ниже порога ограничителя — пускает', async () => {
      const { service, calls } = longService({ weight: WEIGHT_THROTTLE - 1 });
      await service.getHistory('bitcoin', '5m', at(3000));
      const fetched = calls.length;
      await service.getHistory('bitcoin', '5m', at(1500));
      expect(calls.length).toBeGreaterThan(fetched);
    });

    it.each([429, 418])(
      'Binance ответил %i — 429, ограничитель включён до конца минуты',
      async (status) => {
        const { service, calls, state, advance } = longService({
          failStatus: status,
          start: Math.floor(LONG_NOW / 60_000) * 60_000 + 1000,
        });
        const first = await service
          .getHistory('bitcoin', '5m', at(3000))
          .catch((e: unknown) => e);
        expect((first as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
        const fetched = calls.length;

        state.failStatus = undefined;
        const second = await service
          .getHistory('bitcoin', '5m', at(1500))
          .catch((e: unknown) => e);
        expect((second as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
        expect(calls).toHaveLength(fetched);

        advance(60_000);
        await service.getHistory('bitcoin', '5m', at(1500));
        expect(calls.length).toBeGreaterThan(fetched);
      },
    );

    it('основное окно на 429 Binance — 502, как раньше', async () => {
      const { service } = longService({ failStatus: 429 });
      await expect(service.getSeries('bitcoin', '5m', '24h')).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('Binance недоступен — история 502', async () => {
      const { service } = longService({ fail: true });
      await expect(
        service.getHistory('bitcoin', '5m', at(3000)),
      ).rejects.toThrow(BadGatewayException);
    });

    it('нет заголовка веса — одно предупреждение в лог', async () => {
      const { service } = longService({ weight: null });
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      await service.getHistory('bitcoin', '5m', at(3000));
      await service.getHistory('bitcoin', '5m', at(1500));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(service.historyThrottled()).toBe(false);
    });
  });
});
