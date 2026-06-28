import { Module, forwardRef } from '@nestjs/common';
import { AnalyzeService } from './analyze.service';
import { AnalyzeController } from './analyze.controller';
import { PriceModule } from '../price/price.module';
import { AiModule } from '../ai/ai.module';
import { WalletModule } from '../wallet/wallet.module';
import { PositionModule } from '../position/position.module';

@Module({
  imports: [
    forwardRef(() => PriceModule),
    AiModule,
    WalletModule,
    PositionModule,
  ],
  providers: [AnalyzeService],
  controllers: [AnalyzeController],
  exports: [AnalyzeService],
})
export class AnalyzeModule {}
