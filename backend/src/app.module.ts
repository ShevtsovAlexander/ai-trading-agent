import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketModule } from './market/market.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BacktestModule } from './backtest/backtest.module';
import { NewsModule } from './news/news.module';
import { DerivativesModule } from './derivatives/derivatives.module';
import { OrderbookModule } from './orderbook/orderbook.module';
import { CoinModule } from './coin/coin.module';
import { TreasuryModule } from './treasury/treasury.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // читает .env, доступен везде
    ScheduleModule.forRoot(),
    MarketModule,
    BacktestModule,
    NewsModule,
    DerivativesModule,
    OrderbookModule,
    CoinModule,
    TreasuryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
