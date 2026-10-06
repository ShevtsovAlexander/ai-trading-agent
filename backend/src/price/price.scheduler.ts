import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PriceService } from './price.service';
import { MarketService } from '../market/market.service';

@Injectable()
export class PriceScheduler {
  private readonly logger = new Logger(PriceScheduler.name);

  constructor(
    private priceService: PriceService,
    private marketService: MarketService,
  ) {}

  @Cron('0 */5 * * * *')
  async collectAndStore() {
    const coins = [
      { id: 'bitcoin', market: 'BTC/USDT' },
      { id: 'ethereum', market: 'ETH/USDT' },
      { id: 'solana', market: 'SOL/USDT' },
    ];

    for (const coin of coins) {
      try {
        await this.marketService.captureSnapshot({
          market: coin.market,
          coinId: coin.id,
        });
        this.logger.log(`${coin.id}: анализ выполнен`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error) {
        this.logger.error(`Ошибка анализа ${coin.id}: ${error.message}`);
      }
    }
  }
}
