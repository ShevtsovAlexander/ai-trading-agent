import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { PriceScheduler } from './price.scheduler';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [HttpModule, forwardRef(() => MarketModule)],
  providers: [PriceService, PriceScheduler],
  controllers: [PriceController],
  exports: [PriceService],
})
export class PriceModule {}
