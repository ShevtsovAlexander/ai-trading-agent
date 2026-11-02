import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrderbookController } from './orderbook.controller';
import { OrderbookService } from './orderbook.service';
import { BOOK_TIMEOUT_MS } from './orderbook.types';

@Module({
  imports: [HttpModule.register({ timeout: BOOK_TIMEOUT_MS })],
  providers: [OrderbookService],
  controllers: [OrderbookController],
})
export class OrderbookModule {}
