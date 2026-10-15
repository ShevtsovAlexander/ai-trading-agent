import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { calcEMA, calcMACD, calcRSI } from '../indicators/indicators';

// Окно для EMA/RSI/MACD: ~8 ч при шаге крона 5 мин. EMA и RSI Уайлдера
// зависят от длины окна; вся история (до 25 920 строк на 3 мес) ради сотых
// долей на каждом снимке не окупается — docs/aidd/plan/TASK-0002.md.
const INDICATOR_WINDOW = 100;

// Последний элемент ряда из indicators.ts; NaN там — «данных не хватило»
const lastValid = (values: number[]): number | null => {
  const value = values[values.length - 1];
  return value === undefined || Number.isNaN(value) ? null : value;
};

@Injectable()
export class PriceService {
  constructor(
    private httpService: HttpService,
    private prisma: PrismaService,
  ) {}

  async getMovingAverage(coinId: string, points = 5): Promise<number | null> {
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: points,
    });

    if (snapshots.length < points) return null;

    const sum = snapshots.reduce((acc, s) => acc + s.price, 0);
    return sum / snapshots.length;
  }

  // маппинг coinId → Binance symbol
  private readonly BINANCE_SYMBOLS: Record<string, string> = {
    bitcoin: 'BTCUSDT',
    ethereum: 'ETHUSDT',
    solana: 'SOLUSDT',
  };

  async getPrice(coinId: string): Promise<number> {
    const symbol = this.BINANCE_SYMBOLS[coinId];

    if (!symbol) {
      // fallback на CoinGecko для неизвестных монет
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
      const response = await firstValueFrom(this.httpService.get(url));
      const price = response.data[coinId].usd;
      await this.prisma.priceSnapshot.create({ data: { coinId, price } });
      return price;
    }

    // Binance — последняя завершённая 5м свеча
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=2`;
    const response = await firstValueFrom(this.httpService.get(url));

    // берём предпоследнюю свечу — она уже закрыта
    // последняя ещё формируется
    const candle = response.data[0];
    const price = parseFloat(candle[4]); // close

    await this.prisma.priceSnapshot.create({ data: { coinId, price } });

    return price;
  }

  async getPreviousPrice(coinId: string): Promise<number | null> {
    const snapshot = await this.prisma.priceSnapshot.findFirst({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      skip: 1, // пропускаем текущую, берём предыдущую
    });

    return snapshot?.price ?? null;
  }

  async getTrend(coinId: string, points = 10): Promise<'up' | 'down' | 'flat'> {
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: points,
    });

    if (snapshots.length < 2) return 'flat';

    const prices = snapshots.reverse().map((s) => s.price);

    let ups = 0,
      downs = 0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) ups++;
      else if (prices[i] < prices[i - 1]) downs++;
    }

    if (ups > downs * 1.5) return 'up';
    if (downs > ups * 1.5) return 'down';
    return 'flat';
  }

  async getHistory(coinId: string, limit = 50) {
    return this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // Свежие INDICATOR_WINDOW цен в хронологическом порядке — вход для формул
  // из indicators.ts. Берём desc + reverse, как getTrend: asc с take отдавал
  // самые старые строки истории, и EMA/RSI/MACD не менялись с мая (TASK-0002).
  private async recentPrices(coinId: string): Promise<number[]> {
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: INDICATOR_WINDOW,
    });

    return snapshots.reverse().map((s) => s.price);
  }

  // EMA — экспоненциальное скользящее среднее
  async getEMA(coinId: string, period: number): Promise<number | null> {
    const ema = lastValid(calcEMA(await this.recentPrices(coinId), period));
    return ema === null ? null : parseFloat(ema.toFixed(2));
  }

  // RSI — индекс относительной силы, сглаживание Уайлдера
  async getRSI(coinId: string, period = 14): Promise<number | null> {
    const rsi = lastValid(calcRSI(await this.recentPrices(coinId), period));
    return rsi === null ? null : parseFloat(rsi.toFixed(2));
  }

  async getMACD(
    coinId: string,
  ): Promise<{ macd: number; signal: number; histogram: number } | null> {
    const { macd, signal, histogram } = calcMACD(
      await this.recentPrices(coinId),
    );

    // signal валиден позже линии MACD (с индекса 33) — по нему и проверяем
    const lastSignal = lastValid(signal);
    if (lastSignal === null) return null;

    return {
      macd: parseFloat(macd[macd.length - 1].toFixed(2)),
      signal: parseFloat(lastSignal.toFixed(2)),
      // histogram показывает силу импульса:
      // > 0 и растёт → импульс усиливается
      // > 0 и падает → импульс слабеет (возможный разворот)
      histogram: parseFloat(histogram[histogram.length - 1].toFixed(2)),
    };
  }

  async getBollingerBands(
    coinId: string,
    period = 20,
  ): Promise<{
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number; // ширина полос — показывает волатильность рынка
  } | null> {
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: period,
    });

    if (snapshots.length < period) return null;

    const prices = snapshots.map((s) => s.price);

    // Middle = простое среднее за период
    const middle = prices.reduce((a, b) => a + b, 0) / period;

    // Стандартное отклонение — насколько цены разбросаны вокруг среднего
    // Высокое отклонение = высокая волатильность = широкие полосы
    const variance =
      prices.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upper = middle + 2 * stdDev; // цена выше upper → перекуплен
    const lower = middle - 2 * stdDev; // цена ниже lower → перепродан

    // Bandwidth = насколько широки полосы относительно middle
    // Низкий bandwidth → рынок спокоен → возможен скорый прорыв
    // Высокий bandwidth → рынок волатилен → осторожно с входом
    const bandwidth = parseFloat((((upper - lower) / middle) * 100).toFixed(2));

    return {
      upper: parseFloat(upper.toFixed(2)),
      middle: parseFloat(middle.toFixed(2)),
      lower: parseFloat(lower.toFixed(2)),
      bandwidth,
    };
  }
}
