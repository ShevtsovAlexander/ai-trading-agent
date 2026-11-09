import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DerivativesController } from './derivatives.controller';
import { DerivativesService } from './derivatives.service';

// Таймаут 10 с (TASK-0017): Coinalyze и биржи — как у стакана и ликвидаций;
// зависший источник — отказ в его поле, а не висящий маршрут
export const DERIVATIVES_TIMEOUT_MS = 10_000;

@Module({
  imports: [HttpModule.register({ timeout: DERIVATIVES_TIMEOUT_MS })],
  providers: [DerivativesService],
  controllers: [DerivativesController],
})
export class DerivativesModule {}
