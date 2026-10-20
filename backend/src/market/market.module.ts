import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MarketDataService } from './market-data.service';
import { MarketComment } from './market.comment';
import { MarketController } from './market.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [HttpModule, AiModule],
  providers: [MarketDataService, MarketComment],
  controllers: [MarketController],
})
export class MarketModule {}
