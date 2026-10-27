import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketModule } from './market/market.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { BacktestModule } from './backtest/backtest.module';
import { NewsModule } from './news/news.module';
import { DerivativesModule } from './derivatives/derivatives.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // читает .env, доступен везде
    ScheduleModule.forRoot(),
    PrismaModule,
    MarketModule,
    BacktestModule,
    NewsModule,
    DerivativesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
