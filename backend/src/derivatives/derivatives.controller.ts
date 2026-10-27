import { Controller, Get, Param } from '@nestjs/common';
import { DerivativesService } from './derivatives.service';
import { Derivatives } from './derivatives.types';

@Controller('derivatives')
export class DerivativesController {
  constructor(private derivatives: DerivativesService) {}

  // Ставка Binance + мера необычности, OI Binance/OKX/Bybit. 400 —
  // неизвестная монета; отказ биржи — в её поле, не 502
  @Get(':coinId')
  get(@Param('coinId') coinId: string): Promise<Derivatives> {
    return this.derivatives.get(coinId);
  }
}
