import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { fetchClosedCandles } from './klines';

const STEP = 5 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);
const TOTAL = 2500;
// «Сейчас» — внутри последней свечи ряда: она ещё не закрыта
const NOW = T0 + (TOTAL - 1) * STEP + 60_000;

// Известный ряд в формате klines: [openTime, open, high, low, close,
// volume, closeTime, ...]. Цены — функция индекса, чтобы проверять
// и порядок, и содержимое.
const ROWS: unknown[][] = Array.from({ length: TOTAL }, (_, i) => [
  T0 + i * STEP,
  String(100 + i),
  String(101 + i),
  String(99 + i),
  String(100.5 + i),
  String(10 + i),
  T0 + (i + 1) * STEP - 1,
]);

interface KlinesParams {
  startTime?: number;
  endTime?: number;
  limit?: number;
}

// Фейк обязан применять startTime/endTime/limit как Binance (фильтр по
// openTime включительно, по возрастанию, не больше limit): фейк, отдающий
// всё подряд, сделал бы тест пагинации false-green.
// ignoreStartTime — сломанный источник, который всегда отдаёт начало ряда:
// им проверяется защита от бесконечного цикла.
const fakeHttp = ({ ignoreStartTime = false } = {}) => {
  const calls: KlinesParams[] = [];
  const http = {
    get: (_url: string, { params }: { params: KlinesParams }) => {
      calls.push(params);
      const data = ROWS.filter(
        (k) =>
          (ignoreStartTime ||
            params.startTime === undefined ||
            (k[0] as number) >= params.startTime) &&
          (params.endTime === undefined || (k[0] as number) <= params.endTime),
      ).slice(0, params.limit ?? 500);
      return of({ data });
    },
  };
  return { http: http as unknown as HttpService, calls };
};

describe('fetchClosedCandles', () => {
  it('2300 свечей за 3 страницы: шаг везде STEP, без дублей и пропусков на стыках', async () => {
    const { http, calls } = fakeHttp();
    const candles = await fetchClosedCandles(
      http,
      'BTCUSDT',
      '5m',
      T0,
      T0 + 2299 * STEP,
      NOW,
    );

    expect(candles).toHaveLength(2300);
    expect(calls).toHaveLength(3);
    expect(candles[0].t).toBe(T0);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].t - candles[i - 1].t).toBe(STEP);
    }
    // содержимое — та же свеча, что в ряду
    expect(candles[1500]).toEqual({
      t: T0 + 1500 * STEP,
      open: 1600,
      high: 1601,
      low: 1599,
      close: 1600.5,
      volume: 1510,
    });
  });

  it('незакрытая последняя свеча отбрасывается', async () => {
    const { http, calls } = fakeHttp();
    const candles = await fetchClosedCandles(
      http,
      'BTCUSDT',
      '5m',
      T0,
      T0 + TOTAL * STEP,
      NOW,
    );

    expect(candles).toHaveLength(TOTAL - 1);
    expect(candles[candles.length - 1].t).toBe(T0 + (TOTAL - 2) * STEP);
    // 1000 + 1000 + 500: неполная третья страница — конец, четвёртого нет
    expect(calls).toHaveLength(3);
  });

  it('страница не сдвинулась — ошибка, а не бесконечный цикл', async () => {
    const { http, calls } = fakeHttp({ ignoreStartTime: true });
    await expect(
      fetchClosedCandles(http, 'BTCUSDT', '5m', T0, T0 + 2299 * STEP, NOW),
    ).rejects.toThrow('страница не сдвинулась');
    expect(calls).toHaveLength(2);
  });
});
