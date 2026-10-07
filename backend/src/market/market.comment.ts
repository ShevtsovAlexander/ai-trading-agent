import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { MarketSnapshot } from '@prisma/client';
import { AiService } from '../ai/ai.service';

@Injectable()
export class MarketComment {
  private readonly logger = new Logger(MarketComment.name);

  // Кэш по монете: факты не изменились → не гоняем Groq.
  // Хеш считается от тех же полей, что уходят в промпт — иначе кэш
  // промахивался бы на изменениях, которых модель всё равно не видит.
  private readonly cache = new Map<string, { hash: string; comment: string }>();

  private static readonly SYSTEM =
    'Ты крипто-аналитик. Описываешь обстановку на рынке по показаниям ' +
    'приборов, на русском, 2-3 предложения. ' +
    // Рамка проекта: «триггеры, не команды». Решение принимает человек,
    // работа модели — назвать, что происходит, и не более.
    'НЕ давай рекомендаций и НЕ предлагай действий: ни «купить», ни ' +
    '«продать», ни «вход», ни «стоп», ни «стоит»/«не стоит». ' +
    'Только описание: что показывают индикаторы и что это значит про ' +
    'состояние рынка. ' +
    // gpt-oss — reasoning-модель: без явного запрета вписывает ход мыслей
    // в ответ (тот же приём, что в DigestService.SYSTEM).
    'Отвечай только готовым текстом, без рассуждений, пояснений и ' +
    'вводных фраз. Обычный текст без markdown-разметки ' +
    '(без **, ##, списков со звёздочками).';

  constructor(private readonly ai: AiService) {}

  // Весь метод под try: отказ AI-слоя не должен ронять маршрут данных.
  // До этой правки hashFacts и cache.get стояли снаружи, и изоляция
  // держалась на том, что бросить они пока не могут.
  async describe(snapshot: MarketSnapshot): Promise<string | null> {
    let cached: { hash: string; comment: string } | undefined;

    try {
      cached = this.cache.get(snapshot.coinId);
      const hash = this.hashFacts(snapshot);
      if (cached?.hash === hash) return cached.comment; // факты те же

      const comment = (
        await this.ai.complete(this.buildPrompt(snapshot), {
          system: MarketComment.SYSTEM,
          maxTokens: 300,
          temperature: 0.3,
        })
      ).trim();

      // Модель молчит → прошлый комментарий, а не пустая карточка
      if (!comment) return cached?.comment ?? null;

      this.cache.set(snapshot.coinId, { hash, comment });
      return comment;
    } catch (e) {
      this.logger.warn(
        `Комментарий не сгенерён (${snapshot.coinId}): ${String(e)}`,
      );
      return cached?.comment ?? null; // fallback на прошлый
    }
  }

  private buildPrompt(s: MarketSnapshot): string {
    return `Опиши обстановку на рынке ${s.market}.

Цена: $${s.currentPrice}
Тренд: ${s.trend}
RSI: ${this.fmt(s.rsi)}
EMA9: ${this.fmt(s.ema9)}
EMA21: ${this.fmt(s.ema21)}
MACD histogram: ${this.fmt(s.macdHistogram)}
Ширина полос Боллинджера: ${this.fmt(s.bbBandwidth)}%`;
  }

  // Поля снимка nullable: индикаторы возвращают null, пока истории мало
  private fmt(value: number | null): string {
    return value === null ? 'нет данных' : String(value);
  }

  private hashFacts(s: MarketSnapshot): string {
    const facts = [
      s.market,
      s.currentPrice,
      s.trend,
      s.rsi,
      s.ema9,
      s.ema21,
      s.macdHistogram,
      s.bbBandwidth,
    ].join('|');
    return createHash('sha1').update(facts).digest('hex');
  }
}
