import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiModule } from '../ai/ai.module';
import { MarketModule } from '../market/market.module';
import { DigestService } from './digest.service';

@Module({
  // Часовые свечи Binance для фактов свода — таймаут 10 с, как у стакана и
  // полей монеты; режим — MarketDataService (общий кэш дня) (TASK-0012)
  imports: [AiModule, HttpModule.register({ timeout: 10_000 }), MarketModule],
  providers: [DigestService],
  exports: [DigestService],
})
export class DigestModule {}
