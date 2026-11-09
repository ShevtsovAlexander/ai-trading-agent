import { Controller, Get, Param, Query } from '@nestjs/common';
import { LiquidationsService } from './liquidations.service';
import { Liquidations } from './liquidations.types';

@Controller('liquidations')
export class LiquidationsController {
  constructor(private readonly liquidations: LiquidationsService) {}

  // Ликвидации монеты за период (TASK-0015). 400 — монета или период; 502 —
  // нет ключа или отказ Coinalyze; отсутствие биржи — в её поле
  @Get(':coinId')
  get(
    @Param('coinId') coinId: string,
    @Query('period') period: string,
  ): Promise<Liquidations> {
    return this.liquidations.get(coinId, period);
  }
}
