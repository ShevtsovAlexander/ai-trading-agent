import { Injectable, Logger } from '@nestjs/common';
import { PriceService } from '../price/price.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDto } from './market.dto';

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private priceService: PriceService,
    private prisma: PrismaService,
  ) {}

  async captureSnapshot(dto: MarketDto) {
    this.logger.log(`Снимок рынка ${dto.coinId} (${dto.market})`);

    // Цена пишется в PriceSnapshot ДО чтения индикаторов: в одном Promise.all
    // с ними окна EMA/RSI/MACD/BB то включали свежую строку, то нет, а
    // getPreviousPrice (skip: 1) мог пропустить не ту строку (TASK-0002.4).
    const currentPrice = await this.priceService.getPrice(dto.coinId);

    const [previousPrice, trend, movingAverage, ema9, ema21, rsi, macd, bb] =
      await Promise.all([
        this.priceService.getPreviousPrice(dto.coinId),
        this.priceService.getTrend(dto.coinId),
        this.priceService.getMovingAverage(dto.coinId),
        this.priceService.getEMA(dto.coinId, 9),
        this.priceService.getEMA(dto.coinId, 21),
        this.priceService.getRSI(dto.coinId),
        this.priceService.getMACD(dto.coinId),
        this.priceService.getBollingerBands(dto.coinId),
      ]);

    // Возвращаем записанную строку, а не рукотворный объект: до T5 этот
    // метод отдавал вложенные macd/bb и timestamp, а getLatest — плоскую
    // строку Prisma. Две формы «снимка» давали бы разный хеш на одних
    // данных, и кэш комментария промахивался бы молча.
    return this.prisma.marketSnapshot.create({
      data: {
        market: dto.market,
        coinId: dto.coinId,
        currentPrice,
        previousPrice,
        movingAverage: movingAverage
          ? parseFloat(movingAverage.toFixed(2))
          : null,
        ema9,
        ema21,
        rsi,
        macdValue: macd?.macd,
        macdSignal: macd?.signal,
        macdHistogram: macd?.histogram,
        bbUpper: bb?.upper,
        bbMiddle: bb?.middle,
        bbLower: bb?.lower,
        bbBandwidth: bb?.bandwidth,
        trend,
      },
    });
  }

  async getLatest(coinId: string) {
    return this.prisma.marketSnapshot.findFirst({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getHistory(coinId: string, limit = 50) {
    return this.prisma.marketSnapshot.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
