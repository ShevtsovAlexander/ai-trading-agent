import { Injectable, Logger } from '@nestjs/common';
import { PriceService } from '../price/price.service';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AnalyzeDto } from './analyze.dto';
import { PositionService } from '../position/position.service';

// Динамический порог шума для каждой монеты
// BTC менее волатилен — 0.2% уже значимое движение
// SOL более волатилен — 0.4% может быть обычным колебанием
const NOISE_THRESHOLD: Record<string, number> = {
  bitcoin: 0.002, // 0.2%
  ethereum: 0.0025, // 0.25%
  solana: 0.004, // 0.4%
};
const DEFAULT_NOISE_THRESHOLD = 0.003; // 0.3% для остальных монет

@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(
    private priceService: PriceService,
    private aiService: AiService,
    private prisma: PrismaService,
    private walletService: WalletService,
    private positionService: PositionService,
  ) {}

  async analyze(dto: AnalyzeDto) {
    this.logger.log(`Анализ ${dto.coinId} на рынке ${dto.market}`);

    const [
      currentPrice,
      previousPrice,
      trend,
      movingAverage,
      ema9,
      ema21,
      rsi,
      macd,
      bb,
      atr,
    ] = await Promise.all([
      this.priceService.getPrice(dto.coinId),
      this.priceService.getPreviousPrice(dto.coinId),
      this.priceService.getTrend(dto.coinId),
      this.priceService.getMovingAverage(dto.coinId),
      this.priceService.getEMA(dto.coinId, 9),
      this.priceService.getEMA(dto.coinId, 21),
      this.priceService.getRSI(dto.coinId),
      this.priceService.getMACD(dto.coinId),
      this.priceService.getBollingerBands(dto.coinId),
      this.priceService.getATR(dto.coinId),
    ]);

    let decision: 'BUY' | 'SELL' | 'SKIP' = 'SKIP';
    let confidence = 50;
    let riskScore = 5;
    let reason = 'Недостаточно данных';
    // Взвешенные сигналы — не все индикаторы равны
    // EMA и MACD технически сильнее тренда и MA5
    // Порог: сумма весов BUY или SELL должна достичь 4.0

    let weightedSignals = { buy: 0, sell: 0, reasons: [] as string[] };

    if (previousPrice !== null) {
      const changePct = Math.abs(
        (currentPrice - previousPrice) / previousPrice,
      );

      // Берём порог для конкретной монеты или дефолтный
      const noiseThreshold =
        NOISE_THRESHOLD[dto.coinId] ?? DEFAULT_NOISE_THRESHOLD;

      if (changePct < noiseThreshold) {
        reason = `Изменение меньше ${(noiseThreshold * 100).toFixed(1)}% — шум`;
      } else {
        const signals = {
          buy: 0,
          sell: 0,
          reasons: [] as string[],
        };

        // Сигнал 1 — EMA кросс (вес 2.0)
        // Самый надёжный технический сигнал — пересечение быстрой и медленной линий
        if (ema9 !== null && ema21 !== null) {
          if (ema9 > ema21) {
            weightedSignals.buy += 2.0;
            weightedSignals.reasons.push('EMA9 > EMA21 (×2)');
          } else {
            weightedSignals.sell += 2.0;
            weightedSignals.reasons.push('EMA9 < EMA21 (×2)');
          }
        }

        // Сигнал 2 — MACD (вес 2.0)
        // Подтверждает импульс — растущий histogram = усиление движения
        if (macd !== null) {
          if (macd.macd > macd.signal && macd.histogram > 0) {
            weightedSignals.buy += 2.0;
            weightedSignals.reasons.push(
              `MACD бычий hist:${macd.histogram} (×2)`,
            );
          } else if (macd.macd < macd.signal && macd.histogram < 0) {
            weightedSignals.sell += 2.0;
            weightedSignals.reasons.push(
              `MACD медвежий hist:${macd.histogram} (×2)`,
            );
          } else {
            weightedSignals.reasons.push('MACD нейтрален');
          }
        }

        // Сигнал 3 — RSI (вес 1.5)
        // Перепроданность/перекупленность — хороший фильтр но не основной сигнал
        if (rsi !== null) {
          if (rsi < 35) {
            weightedSignals.buy += 1.5;
            weightedSignals.reasons.push(`RSI ${rsi} перепродан (×1.5)`);
          } else if (rsi > 65) {
            weightedSignals.sell += 1.5;
            weightedSignals.reasons.push(`RSI ${rsi} перекуплен (×1.5)`);
          } else {
            weightedSignals.reasons.push(`RSI ${rsi} нейтрален`);
          }
        }

        // Сигнал 4 — Bollinger Bands (вес 1.5)
        // Цена у границ полос = потенциальный разворот
        if (bb !== null) {
          if (bb.bandwidth < 1) {
            // Сжатие — рынок готовится к движению, направление неизвестно
            weightedSignals.reasons.push(
              `BB сжатие bandwidth:${bb.bandwidth}%`,
            );
          } else if (currentPrice <= bb.lower * 1.001) {
            weightedSignals.buy += 1.5;
            weightedSignals.reasons.push(`Цена у нижней BB (×1.5)`);
          } else if (currentPrice >= bb.upper * 0.999) {
            weightedSignals.sell += 1.5;
            weightedSignals.reasons.push(`Цена у верхней BB (×1.5)`);
          } else {
            weightedSignals.reasons.push('BB нейтрален');
          }
        }

        // Сигнал 5 — тренд (вес 1.0)
        // Подтверждающий сигнал — слабее технических индикаторов
        if (trend === 'up') {
          weightedSignals.buy += 1.0;
          weightedSignals.reasons.push('Тренд вверх (×1)');
        } else if (trend === 'down') {
          weightedSignals.sell += 1.0;
          weightedSignals.reasons.push('Тренд вниз (×1)');
        } else {
          weightedSignals.reasons.push('Тренд боковой');
        }

        // Сигнал 6 — MA5 (вес 1.0)
        // Слабый краткосрочный сигнал — только подтверждает
        if (movingAverage !== null) {
          const maDeviation = (currentPrice - movingAverage) / movingAverage;
          if (maDeviation < -noiseThreshold) {
            weightedSignals.buy += 1.0;
            weightedSignals.reasons.push(
              `Ниже MA5 на ${(maDeviation * 100).toFixed(2)}% (×1)`,
            );
          } else if (maDeviation > noiseThreshold) {
            weightedSignals.sell += 1.0;
            weightedSignals.reasons.push(
              `Выше MA5 на ${(maDeviation * 100).toFixed(2)}% (×1)`,
            );
          }
        }

        reason = weightedSignals.reasons.join(' | ');

        // Weighted confluence порог — сумма весов должна достичь 4.0
        // Максимум возможных весов: EMA(2) + MACD(2) + RSI(1.5) + BB(1.5) + тренд(1) + MA5(1) = 9.0
        // Порог 4.0 = примерно 2 сильных сигнала или 1 сильный + 2 слабых
        const threshold = 4.0;

        if (weightedSignals.buy >= threshold) {
          decision = 'BUY';
          // Confidence пропорционален насколько превысили порог
          const overThreshold = weightedSignals.buy - threshold;
          confidence = Math.round(60 + overThreshold * 8);
          riskScore = Math.max(Math.round(5 - weightedSignals.buy / 2), 1);
        } else if (weightedSignals.sell >= threshold) {
          decision = 'SELL';
          const overThreshold = weightedSignals.sell - threshold;
          confidence = Math.round(60 + overThreshold * 8);
          riskScore = Math.max(Math.round(5 - weightedSignals.sell / 2), 1);
        } else {
          decision = 'SKIP';
          confidence = 40;
          riskScore = 6;
          reason += ' | Нет weighted confluence';
        }

        confidence = Math.min(confidence, 95);

        // 2. Потом контрарная коррекция уточняет confidence и riskScore
        // Контрарная коррекция — когда торгуем против тренда
        // Тренд против сигнала не отменяет решение но увеличивает риск
        // Компенсируем если RSI и MACD histogram подтверждают разворот
        if (decision !== 'SKIP') {
          const againstTrend =
            (decision === 'BUY' && trend === 'down') ||
            (decision === 'SELL' && trend === 'up');

          if (againstTrend) {
            // Базовый штраф за торговлю против тренда
            confidence = Math.max(confidence - 15, 30);
            riskScore = Math.min(riskScore + 2, 10);

            // Частичная компенсация если RSI подтверждает разворот
            // RSI < 30 при BUY или RSI > 70 при SELL — сильный сигнал разворота
            if (rsi !== null) {
              if (decision === 'BUY' && rsi < 30) {
                confidence += 10;
                riskScore = Math.max(riskScore - 1, 1);
              } else if (decision === 'SELL' && rsi > 70) {
                confidence += 10;
                riskScore = Math.max(riskScore - 1, 1);
              }
            }

            // Дополнительная компенсация если MACD histogram растёт в сторону сигнала
            // Растущий histogram при BUY = импульс разворачивается вверх
            if (macd !== null) {
              if (decision === 'BUY' && macd.histogram > 0) {
                confidence += 8;
                riskScore = Math.max(riskScore - 1, 1);
              } else if (decision === 'SELL' && macd.histogram < 0) {
                confidence += 8;
                riskScore = Math.max(riskScore - 1, 1);
              }
            }

            reason += ' | Контрарный сигнал (против тренда)';
          }

          confidence = Math.min(confidence, 95);
        }
      }
    }
    const priceDelta = previousPrice
      ? (currentPrice - previousPrice) / previousPrice
      : 0;
    const volumeFactor = Math.log1p(dto.volume) / 10;
    const expectedValue = (confidence / 100) * volumeFactor * priceDelta;

    const aiReasoning = await this.aiService.analyze(
      dto.market,
      currentPrice,
      decision,
      reason,
      trend,
    );

    const result = {
      market: dto.market,
      currentPrice,
      previousPrice,
      movingAverage: movingAverage
        ? parseFloat(movingAverage.toFixed(2))
        : null,
      ema9,
      ema21,
      rsi,
      macd: macd ? { ...macd } : null,
      bb: bb ? { ...bb } : null,
      trend,
      decision,
      confidence,
      riskScore,
      expectedValue: parseFloat(expectedValue.toFixed(4)),
      reason,
      aiReasoning,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(
      `Решение: ${result.decision} | confidence: ${result.confidence} | RSI: ${rsi} | buy: ${weightedSignals.buy} | sell: ${weightedSignals.sell}`,
    );

    if (result.decision !== 'SKIP') {
      this.logger.warn(
        `Активный сигнал: ${result.decision} ${dto.coinId} @ $${result.currentPrice}`,
      );
    }

    await this.prisma.tradeDecision.create({
      data: {
        market: result.market,
        coinId: dto.coinId,
        currentPrice: result.currentPrice,
        previousPrice: result.previousPrice,
        movingAverage: result.movingAverage,
        ema9: result.ema9,
        ema21: result.ema21,
        rsi: result.rsi,
        macdValue: result.macd?.macd,
        macdSignal: result.macd?.signal,
        macdHistogram: result.macd?.histogram,
        bbUpper: result.bb?.upper,
        bbMiddle: result.bb?.middle,
        bbLower: result.bb?.lower,
        bbBandwidth: result.bb?.bandwidth,
        trend: result.trend,
        decision: result.decision,
        confidence: result.confidence,
        riskScore: result.riskScore,
        expectedValue: result.expectedValue,
        reason: result.reason,
        aiReasoning: result.aiReasoning,
      },
    });

    // Управление позициями
    if (previousPrice !== null) {
      // Сначала проверяем существующую позицию — возможно стоп сработал
      const closedPosition = await this.positionService.checkAndUpdatePosition(
        dto.coinId,
        currentPrice,
        atr,
      );

      // Если позиция закрылась по стопу — обновляем баланс
      if (
        closedPosition &&
        closedPosition.status === 'CLOSED' &&
        closedPosition.pnl !== null
      ) {
        await this.walletService.applyDecision(
          dto.coinId,
          closedPosition.decision,
          closedPosition.closedPrice!,
          closedPosition.entryPrice,
        );
      }

      // Если новый сигнал BUY/SELL и нет открытой позиции — открываем
      if (result.decision !== 'SKIP') {
        const openPosition = await this.positionService.getOpenPosition(
          dto.coinId,
        );
        if (!openPosition) {
          await this.positionService.openPosition(
            dto.coinId,
            dto.market,
            result.decision,
            currentPrice,
            atr,
          );
        }
      }
    }

    return result;
  }

  async getDecisions(coinId: string, limit = 50) {
    return this.prisma.tradeDecision.findMany({
      where: { coinId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
