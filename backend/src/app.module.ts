import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalyzeModule } from './analyze/analyze.module';
import { PriceModule } from './price/price.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { WalletModule } from './wallet/wallet.module';
import { PositionModule } from './position/position.module';
import { BacktestModule } from './backtest/backtest.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // читает .env, доступен везде
    ScheduleModule.forRoot(),
    PrismaModule,
    WalletModule,
    AnalyzeModule,
    PositionModule,
    PriceModule,
    BacktestModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
