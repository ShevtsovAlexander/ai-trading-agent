import { Controller, Get, Param } from '@nestjs/common';
import { TreasuryService } from './treasury.service';

@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  // Компании-держатели монеты (TASK-0013). 400 — монета; 502 — CoinGecko
  @Get(':coinId')
  get(@Param('coinId') coinId: string) {
    return this.treasury.get(coinId);
  }
}
