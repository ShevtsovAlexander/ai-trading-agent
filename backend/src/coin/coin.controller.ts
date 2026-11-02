import { Controller, Get, Param } from '@nestjs/common';
import { CoinService } from './coin.service';
import { CoinFields } from './coin.types';

@Controller('coin')
export class CoinController {
  constructor(private coin: CoinService) {}

  // Капитализация, FDV, предложение с CoinGecko (TASK-0010). 400 —
  // неизвестная монета; отказ CoinGecko — 502 с текстом
  @Get(':coinId')
  get(@Param('coinId') coinId: string): Promise<CoinFields> {
    return this.coin.get(coinId);
  }
}
