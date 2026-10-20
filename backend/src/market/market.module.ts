import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MarketService } from './market.service';
import { MarketDataService } from './market-data.service';
import { MarketComment } from './market.comment';
import { MarketController } from './market.controller';
import { PriceModule } from '../price/price.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [HttpModule, forwardRef(() => PriceModule), AiModule],
  providers: [MarketService, MarketDataService, MarketComment],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
