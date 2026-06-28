import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

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
    const high = parseFloat(candle[2]);
    const low = parseFloat(candle[3]);
    const price = parseFloat(candle[4]); // close

    await this.prisma.priceSnapshot.create({
      data: { coinId, price, high, low },
    });

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

  // EMA — экспоненциальное скользящее среднее
  async getEMA(coinId: string, period: number): Promise<number | null> {
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'asc' },
      take: period * 3, // берём больше данных для точности
    });

    if (snapshots.length < period) return null;

    const prices = snapshots.map((s) => s.price);
    const k = 2 / (period + 1);

    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }

    return parseFloat(ema.toFixed(2));
  }

  // RSI — индекс относительной силы
  async getRSI(coinId: string, period = 14): Promise<number | null> {
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'asc' },
      take: period + 10,
    });

    if (snapshots.length < period + 1) return null;

    const prices = snapshots.map((s) => s.price);
    const changes = prices.slice(1).map((p, i) => p - prices[i]);

    const gains = changes.map((c) => (c > 0 ? c : 0));
    const losses = changes.map((c) => (c < 0 ? Math.abs(c) : 0));

    const avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
  }

  async getMACD(
    coinId: string,
  ): Promise<{ macd: number; signal: number; histogram: number } | null> {
    // Берём достаточно данных для расчёта EMA26 + запас для сигнальной линии
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'asc' },
      take: 26 * 3,
    });

    if (snapshots.length < 26) return null;

    const prices = snapshots.map((s) => s.price);

    // Вспомогательная функция — считает EMA для любого массива и периода
    const calcEMA = (data: number[], period: number): number[] => {
      const k = 2 / (period + 1); // вес последней точки — чем меньше период, тем больше вес
      const emas: number[] = [];
      let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period; // первое значение — простое среднее
      emas.push(ema);
      for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k); // каждое следующее = текущая цена * вес + прошлое EMA * (1 - вес)
        emas.push(ema);
      }
      return emas;
    };

    const ema12 = calcEMA(prices, 12); // быстрая линия — реагирует на свежие движения
    const ema26 = calcEMA(prices, 26); // медленная линия — показывает общий тренд

    // EMA26 короче EMA12 на 14 элементов — выравниваем чтобы вычесть поточечно
    const offset = ema12.length - ema26.length;
    const macdLine = ema26.map((v, i) => ema12[i + offset] - v);
    // macdLine > 0 → быстрая выше медленной → бычий импульс
    // macdLine < 0 → быстрая ниже медленной → медвежий импульс

    if (macdLine.length < 9) return null;

    const signalLine = calcEMA(macdLine, 9); // сигнальная линия — EMA9 от самого MACD
    const lastMacd = macdLine[macdLine.length - 1];
    const lastSignal = signalLine[signalLine.length - 1];

    return {
      macd: parseFloat(lastMacd.toFixed(2)),
      signal: parseFloat(lastSignal.toFixed(2)),
      // histogram показывает силу импульса:
      // > 0 и растёт → импульс усиливается
      // > 0 и падает → импульс слабеет (возможный разворот)
      histogram: parseFloat((lastMacd - lastSignal).toFixed(2)),
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

  async getATR(coinId: string, period = 14): Promise<number | null> {
    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'asc' },
      take: period + 1,
    });

    if (snapshots.length < period + 1) return null;

    const trueRanges: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const curr = snapshots[i];
      const prevClose = snapshots[i - 1].price;

      const high = curr.high ?? curr.price;
      const low = curr.low ?? curr.price;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      trueRanges.push(tr);
    }

    const atr = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
    return parseFloat(atr.toFixed(2));
  }
}
