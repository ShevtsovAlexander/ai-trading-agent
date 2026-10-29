import { Controller, Get, Param, Query } from '@nestjs/common';
import { DerivativesService } from './derivatives.service';
import { Derivatives, OpenInterestHistory } from './derivatives.types';

@Controller('derivatives')
export class DerivativesController {
  constructor(private derivatives: DerivativesService) {}

  // Ставка Binance + мера необычности, OI Binance/OKX/Bybit. 400 —
  // неизвестная монета; отказ биржи — в её поле, не 502
  @Get(':coinId')
  get(@Param('coinId') coinId: string): Promise<Derivatives> {
    return this.derivatives.get(coinId);
  }

  // Ряд OI Binance + OKX + Bybit за 30 дней и цена спота (TASK-0008). 400 —
  // неизвестная монета или шаг (1d | 1h); отказ биржи — в её поле
  @Get(':coinId/open-interest')
  openInterest(
    @Param('coinId') coinId: string,
    @Query('step') step: string,
  ): Promise<OpenInterestHistory> {
    return this.derivatives.openInterestHistory(coinId, step);
  }
}
