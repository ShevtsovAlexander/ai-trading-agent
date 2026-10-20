import { Controller, Get, Param, Query } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { MarketComment } from './market.comment';

@Controller('market')
export class MarketController {
  constructor(
    private marketData: MarketDataService,
    private marketComment: MarketComment,
  ) {}

  // Свечи диапазона + ряды индикаторов по ним (разогрев отрезан).
  // Валидация интервала/диапазона/монеты — в сервисе: 400; Binance — 502.
  @Get('candles/:coinId')
  getCandles(
    @Param('coinId') coinId: string,
    @Query('interval') interval: string,
    @Query('range') range: string,
  ) {
    return this.marketData.getSeries(coinId, interval, range);
  }

  // Последняя закрытая свеча интервала + AI-комментарий к ней (кэш по
  // монете и интервалу; отказ модели → прошлый комментарий или null)
  @Get('view/:coinId')
  async getView(
    @Param('coinId') coinId: string,
    @Query('interval') interval: string,
  ) {
    const view = await this.marketData.getView(coinId, interval);
    return { ...view, aiComment: await this.marketComment.describeView(view) };
  }
}
