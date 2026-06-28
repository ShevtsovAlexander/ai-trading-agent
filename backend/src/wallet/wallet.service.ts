import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async getWallet() {
    let wallet = await this.prisma.wallet.findFirst();

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { balance: 100, initialBalance: 100 },
      });
    }

    return wallet;
  }

  async deposit(amount: number) {
    const wallet = await this.getWallet();

    await this.prisma.walletTransaction.create({
      data: {
        amount,
        type: 'DEPOSIT',
        coinId: 'system',
        decision: 'DEPOSIT',
        price: 0,
      },
    });

    return this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: wallet.balance + amount,
        initialBalance: wallet.balance + amount,
      },
    });
  }

  async applyDecision(
    coinId: string,
    decision: string,
    price: number,
    previousPrice: number,
  ) {
    const wallet = await this.getWallet();
    if (decision === 'SKIP') return wallet;

    const changePct = (price - previousPrice) / previousPrice;
    const tradeAmount = wallet.balance * 0.05; // 5% от баланса на сделку
    const pnl =
      decision === 'BUY' ? tradeAmount * changePct : tradeAmount * -changePct;

    await this.prisma.walletTransaction.create({
      data: {
        amount: pnl,
        type: pnl >= 0 ? 'PROFIT' : 'LOSS',
        coinId,
        decision,
        price,
      },
    });

    return this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: wallet.balance + pnl },
    });
  }

  async getBalanceHistory(period: 'day' | 'week' | 'month' | 'all') {
    const periodMap = { day: 1, week: 7, month: 30, all: 36500 };
    const from = new Date();
    from.setDate(from.getDate() - periodMap[period]);

    const transactions = await this.prisma.walletTransaction.findMany({
      where: period === 'all' ? {} : { createdAt: { gte: from } },
      orderBy: { createdAt: 'asc' },
    });

    const wallet = await this.getWallet();
    let balance = wallet.initialBalance;

    return transactions.map((t) => {
      balance += t.amount;
      return {
        date: new Date(t.createdAt).toLocaleDateString('ru', {
          month: 'short',
          day: 'numeric',
        }),
        balance: parseFloat(balance.toFixed(2)),
      };
    });
  }

  async getStats(period: 'day' | 'week' | 'month' | 'all') {
    const wallet = await this.getWallet();

    const periodMap = {
      day: 1,
      week: 7,
      month: 30,
      all: 36500,
    };

    const from = new Date();
    from.setDate(from.getDate() - periodMap[period]);

    const transactions = await this.prisma.walletTransaction.findMany({
      where: period === 'all' ? {} : { createdAt: { gte: from } },
      orderBy: { createdAt: 'asc' },
    });

    const profit = transactions
      .filter((t) => t.type === 'PROFIT')
      .reduce((sum, t) => sum + t.amount, 0);

    const loss = transactions
      .filter((t) => t.type === 'LOSS')
      .reduce((sum, t) => sum + t.amount, 0);

    const pnl = profit + loss;
    const pnlPct = (pnl / wallet.initialBalance) * 100;

    return {
      balance: parseFloat(wallet.balance.toFixed(2)),
      initialBalance: wallet.initialBalance,
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: parseFloat(pnlPct.toFixed(2)),
      profit: parseFloat(profit.toFixed(2)),
      loss: parseFloat(loss.toFixed(2)),
      transactions: transactions.length,
    };
  }
}
