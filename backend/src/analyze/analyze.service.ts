import { Injectable, Logger } from '@nestjs/common';
import { PriceService } from '../price/price.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyzeDto } from './analyze.dto';

@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(
    private priceService: PriceService,
    private prisma: PrismaService,
  ) {}

  async analyze(dto: AnalyzeDto) {
    this.logger.log(`Анализ ${dto.coinId} на рынке ${dto.market}`);

    const [
      currentPrice,
      previousPrice,
      trend,
      movingAverage,
      ema9,
      ema21,
      rsi,
      macd,
      bb,
    ] = await Promise.all([
      this.priceService.getPrice(dto.coinId),
      this.priceService.getPreviousPrice(dto.coinId),
      this.priceService.getTrend(dto.coinId),
      this.priceService.getMovingAverage(dto.coinId),
      this.priceService.getEMA(dto.coinId, 9),
      this.priceService.getEMA(dto.coinId, 21),
      this.priceService.getRSI(dto.coinId),
      this.priceService.getMACD(dto.coinId),
      this.priceService.getBollingerBands(dto.coinId),
    ]);

    const result = {
      market: dto.market,
      currentPrice,
      previousPrice,
      movingAverage: movingAverage
        ? parseFloat(movingAverage.toFixed(2))
        : null,
      ema9,
      ema21,
      rsi,
      macd: macd ? { ...macd } : null,
      bb: bb ? { ...bb } : null,
      trend,
      timestamp: new Date().toISOString(),
    };

    await this.prisma.tradeDecision.create({
      data: {
        market: result.market,
        coinId: dto.coinId,
        currentPrice: result.currentPrice,
        previousPrice: result.previousPrice,
        movingAverage: result.movingAverage,
        ema9: result.ema9,
        ema21: result.ema21,
        rsi: result.rsi,
        macdValue: result.macd?.macd,
        macdSignal: result.macd?.signal,
        macdHistogram: result.macd?.histogram,
        bbUpper: result.bb?.upper,
        bbMiddle: result.bb?.middle,
        bbLower: result.bb?.lower,
        bbBandwidth: result.bb?.bandwidth,
        trend: result.trend,
      },
    });

    return result;
  }

  async getDecisions(coinId: string, limit = 50) {
    return this.prisma.tradeDecision.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
