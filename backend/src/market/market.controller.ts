import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketDto } from './market.dto';

@Controller('market')
export class MarketController {
  constructor(private marketService: MarketService) {}

  @Post('refresh')
  async refresh(@Body() body: MarketDto) {
    return this.marketService.captureSnapshot(body);
  }

  @Get('snapshot/:coinId')
  getLatest(@Param('coinId') coinId: string) {
    return this.marketService.getLatest(coinId);
  }

  @Get('history/:coinId')
  getHistory(@Param('coinId') coinId: string, @Query('limit') limit?: string) {
    return this.marketService.getHistory(coinId, limit ? parseInt(limit) : 50);
  }
}
