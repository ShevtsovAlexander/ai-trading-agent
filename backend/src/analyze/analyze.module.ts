import { Module, forwardRef } from '@nestjs/common';
import { AnalyzeService } from './analyze.service';
import { AnalyzeController } from './analyze.controller';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [forwardRef(() => PriceModule)],
  providers: [AnalyzeService],
  controllers: [AnalyzeController],
  exports: [AnalyzeService],
})
export class AnalyzeModule {}
