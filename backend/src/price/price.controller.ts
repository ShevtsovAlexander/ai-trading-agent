import { Controller, Get, Param, Query } from '@nestjs/common';
import { PriceService } from './price.service';

@Controller('price')
export class PriceController {
  constructor(private priceService: PriceService) {}

  @Get(':coinId')
  async getPrice(@Param('coinId') coinId: string) {
    const price = await this.priceService.getPrice(coinId);
    return {
      coin: coinId,
      price,
      currency: 'usd',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('history/:coinId')
  getHistory(@Param('coinId') coinId: string, @Query('limit') limit?: string) {
    return this.priceService.getHistory(coinId, limit ? parseInt(limit) : 50);
  }
}
