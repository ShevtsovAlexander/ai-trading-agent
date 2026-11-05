import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LiquidationsController } from './liquidations.controller';
import { LiquidationsService } from './liquidations.service';
import { LIQ_TIMEOUT_MS } from './liquidations.types';

@Module({
  imports: [HttpModule.register({ timeout: LIQ_TIMEOUT_MS })],
  providers: [LiquidationsService],
  controllers: [LiquidationsController],
})
export class LiquidationsModule {}
