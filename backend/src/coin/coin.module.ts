import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CoinController } from './coin.controller';
import { CoinService } from './coin.service';
import { COIN_TIMEOUT_MS } from './coin.types';

@Module({
  imports: [HttpModule.register({ timeout: COIN_TIMEOUT_MS })],
  providers: [CoinService],
  controllers: [CoinController],
  // Знаменатель доли компаний-держателей (TASK-0013)
  exports: [CoinService],
})
export class CoinModule {}
