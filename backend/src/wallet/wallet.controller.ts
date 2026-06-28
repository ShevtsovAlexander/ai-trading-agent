import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get()
  getWallet() {
    return this.walletService.getWallet();
  }

  @Post('deposit')
  deposit(@Body() body: { amount: number }) {
    return this.walletService.deposit(body.amount);
  }

  @Get('stats')
  getStats(@Query('period') period: 'day' | 'week' | 'month' | 'all' = 'all') {
    return this.walletService.getStats(period);
  }

  @Get('history')
  getBalanceHistory(
    @Query('period') period: 'day' | 'week' | 'month' | 'all' = 'all',
  ) {
    return this.walletService.getBalanceHistory(period);
  }
}
