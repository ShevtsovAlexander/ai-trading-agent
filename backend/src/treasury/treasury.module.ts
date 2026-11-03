import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CoinModule } from '../coin/coin.module';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { TREASURY_TIMEOUT_MS } from './treasury.types';

@Module({
  // CoinModule — знаменатель доли (CoinService, общий снимок 60 с)
  imports: [HttpModule.register({ timeout: TREASURY_TIMEOUT_MS }), CoinModule],
  providers: [TreasuryService],
  controllers: [TreasuryController],
})
export class TreasuryModule {}
