import { Controller, Get, Param } from '@nestjs/common';
import { OrderbookService } from './orderbook.service';
import { OrderBookSnapshot } from './orderbook.types';

@Controller('orderbook')
export class OrderbookController {
  constructor(private orderbook: OrderbookService) {}

  // Стены стакана спота Binance + OKX (TASK-0009). 400 — неизвестная
  // монета; отказ биржи — в её поле, не 502
  @Get(':coinId')
  get(@Param('coinId') coinId: string): Promise<OrderBookSnapshot> {
    return this.orderbook.get(coinId);
  }
}
