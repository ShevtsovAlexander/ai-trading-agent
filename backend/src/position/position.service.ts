import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PositionService {
  private readonly logger = new Logger(PositionService.name);

  constructor(private prisma: PrismaService) {}
  private readonly ATR_MULTIPLIER = 1.5;

  // Открываем новую позицию при BUY/SELL сигнале
  // ATR-based stop: ставим стоп на 2% от цены входа — достаточно далеко чтобы не выбило шумом
  async openPosition(
    coinId: string,
    market: string,
    decision: string,
    entryPrice: number,
    atr: number | null, // передаём снаружи
  ) {
    const existing = await this.getOpenPosition(coinId);
    if (existing) {
      this.logger.log(
        `${coinId}: позиция уже открыта @ $${existing.entryPrice}`,
      );
      return existing;
    }

    // ATR стоп если есть данные, иначе fallback 2%
    const stopDistance =
      atr != null ? atr * this.ATR_MULTIPLIER : entryPrice * 0.02;

    const stopLoss =
      decision === 'BUY'
        ? entryPrice - stopDistance
        : entryPrice + stopDistance;

    const position = await this.prisma.position.create({
      data: {
        coinId,
        market,
        decision,
        entryPrice,
        stopLoss,
        highPrice: entryPrice,
        lowPrice: entryPrice,
        status: 'OPEN',
      },
    });

    this.logger.warn(
      `${coinId}: открыта ${decision} @ $${entryPrice} | стоп: $${stopLoss.toFixed(2)} | ATR: ${atr?.toFixed(2) ?? 'N/A'}`,
    );
    return position;
  }

  // Проверяем позицию на каждом cron цикле
  // Двигаем trailing stop вверх если цена выросла
  // Закрываем если цена пробила стоп
  async checkAndUpdatePosition(
    coinId: string,
    currentPrice: number,
    atr: number | null, // передаём снаружи
  ) {
    const position = await this.getOpenPosition(coinId);
    if (!position) return null;

    const { decision, stopLoss, highPrice, lowPrice } = position;
    let newStopLoss = stopLoss;
    let newHighPrice = highPrice;
    let newLowPrice = lowPrice;

    // дистанция trailing = ATR * multiplier или fallback 2%
    const trailDistance =
      atr != null ? atr * this.ATR_MULTIPLIER : currentPrice * 0.02;

    if (decision === 'BUY') {
      if (currentPrice > highPrice) {
        newHighPrice = currentPrice;
        const trailingStop = currentPrice - trailDistance;
        newStopLoss = Math.max(stopLoss, trailingStop);
        this.logger.log(
          `${coinId}: новый хай $${currentPrice} | стоп → $${newStopLoss.toFixed(2)}`,
        );
      }
      if (currentPrice <= newStopLoss) {
        return this.closePosition(position.id, currentPrice);
      }
    }

    if (decision === 'SELL') {
      if (currentPrice < lowPrice) {
        newLowPrice = currentPrice;
        const trailingStop = currentPrice + trailDistance;
        newStopLoss = Math.min(stopLoss, trailingStop);
        this.logger.log(
          `${coinId}: новый лоу $${currentPrice} | стоп → $${newStopLoss.toFixed(2)}`,
        );
      }
      if (currentPrice >= newStopLoss) {
        return this.closePosition(position.id, currentPrice);
      }
    }

    await this.prisma.position.update({
      where: { id: position.id },
      data: {
        stopLoss: newStopLoss,
        highPrice: newHighPrice,
        lowPrice: newLowPrice,
      },
    });

    return position;
  }
  // Закрываем позицию и считаем P&L
  async closePosition(positionId: number, closePrice: number) {
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
    });
    if (!position) return null;

    // P&L = разница между ценой выхода и входа
    // Для BUY: выросла цена = прибыль, упала = убыток
    // Для SELL: упала цена = прибыль, выросла = убыток
    const priceDiff = closePrice - position.entryPrice;
    const pnl = position.decision === 'BUY' ? priceDiff : -priceDiff;
    const pnlPct = (pnl / position.entryPrice) * 100;

    const closed = await this.prisma.position.update({
      where: { id: positionId },
      data: {
        status: 'CLOSED',
        closedPrice: closePrice,
        closedAt: new Date(),
        pnl,
      },
    });

    this.logger.warn(
      `${position.coinId}: позиция закрыта @ $${closePrice} | P&L: ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
    );

    return closed;
  }

  async getOpenPosition(coinId: string) {
    return this.prisma.position.findFirst({
      where: { coinId, status: 'OPEN' },
    });
  }

  async getAllPositions(coinId?: string) {
    const positions = await this.prisma.position.findMany({
      where: coinId ? { coinId } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Для открытых позиций считаем unrealized P&L из текущей цены
    // Текущая цена = последний PriceSnapshot по coinId
    const openPositions = positions.filter((p) => p.status === 'OPEN');

    if (openPositions.length === 0) return positions;

    // Берём последние цены для всех монет с открытыми позициями одним запросом
    const coinIds = [...new Set(openPositions.map((p) => p.coinId))];

    const latestPrices = await Promise.all(
      coinIds.map((id) =>
        this.prisma.priceSnapshot.findFirst({
          where: { coinId: id },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    );

    const priceMap = Object.fromEntries(
      latestPrices.filter(Boolean).map((snap) => [snap!.coinId, snap!.price]),
    );

    return positions.map((pos) => {
      if (pos.status !== 'OPEN' || !priceMap[pos.coinId]) return pos;

      const currentPrice = priceMap[pos.coinId];
      const priceDiff = currentPrice - pos.entryPrice;
      const unrealizedPnl = pos.decision === 'BUY' ? priceDiff : -priceDiff;

      return {
        ...pos,
        pnl: parseFloat(unrealizedPnl.toFixed(2)),
      };
    });
  }
}
