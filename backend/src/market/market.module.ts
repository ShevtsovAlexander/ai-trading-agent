import { Module, forwardRef } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [forwardRef(() => PriceModule)],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
