import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketComment } from './market.comment';
import { MarketDto } from './market.dto';

@Controller('market')
export class MarketController {
  constructor(
    private marketService: MarketService,
    private marketComment: MarketComment,
  ) {}

  @Post('refresh')
  async refresh(@Body() body: MarketDto) {
    const snapshot = await this.marketService.captureSnapshot(body);
    return {
      ...snapshot,
      aiComment: await this.marketComment.describe(snapshot),
    };
  }

  @Get('snapshot/:coinId')
  async getLatest(@Param('coinId') coinId: string) {
    const snapshot = await this.marketService.getLatest(coinId);
    if (!snapshot) return null;

    return {
      ...snapshot,
      aiComment: await this.marketComment.describe(snapshot),
    };
  }

  // История идёт без комментария: он «на лету», а не в строке БД —
  // гонять модель на 50 снимков незачем (plan, trade-off 3).
  @Get('history/:coinId')
  getHistory(@Param('coinId') coinId: string, @Query('limit') limit?: string) {
    return this.marketService.getHistory(coinId, limit ? parseInt(limit) : 50);
  }
}
