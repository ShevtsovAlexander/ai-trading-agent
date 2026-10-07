import { Module, forwardRef } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketComment } from './market.comment';
import { MarketController } from './market.controller';
import { PriceModule } from '../price/price.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [forwardRef(() => PriceModule), AiModule],
  providers: [MarketService, MarketComment],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
