import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiService } from '../ai/ai.service';
import { NewsItem } from '../news/news.types';
import { Digest } from './digest.types';

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  // Кэш по хешу набора id: лента не изменилась → не гоняем Groq
  private cached: { hash: string; digest: Digest } | null = null;

  private static readonly SYSTEM =
    'Ты крипто-аналитик. Делаешь краткий дайджест новостей на русском. ' +
    'Только факты из заголовков, без домыслов. Тикеры и имена не переводи.';

  constructor(private readonly ai: AiService) {}

  // Вызывается из NewsService.refresh() после сборки ленты
  async generate(items: NewsItem[]): Promise<Digest | null> {
    if (items.length === 0) return this.cached?.digest ?? null;

    const hash = this.hashItems(items);
    if (this.cached?.hash === hash) return this.cached.digest; // лента та же

    try {
      const summary = await this.build(items);
      if (!summary) return this.cached?.digest ?? null; // модель молчит → старый

      const digest: Digest = {
        summary,
        generatedAt: new Date().toISOString(),
        itemCount: items.length,
      };
      this.cached = { hash, digest };
      return digest;
    } catch (e) {
      this.logger.warn(`Дайджест не сгенерён: ${String(e)}`);
      return this.cached?.digest ?? null; // fallback на прошлый
    }
  }

  getDigest(): Digest | null {
    return this.cached?.digest ?? null;
  }

  private async build(items: NewsItem[]): Promise<string> {
    // Берём топ-20 свежих — больше не нужно, дайджест про главное.
    // Экономия токенов: 50 заголовков → 20.
    const headlines = items
      .slice(0, 20)
      .map((it, i) => `${i + 1}. ${it.title}`)
      .join('\n');

    const prompt = `Сделай дайджест крипто-новостей за час. 3-5 предложений.
Сгруппируй по темам (цена, регуляторка, технологии).
НЕ пересказывай заголовки дословно — обобщай тренд.
Без вводных.

${headlines}`;

    return this.ai.complete(prompt, {
      system: DigestService.SYSTEM,
      maxTokens: 400,
      temperature: 0.3,
    });
  }

  private hashItems(items: NewsItem[]): string {
    const ids = items
      .map((i) => i.id)
      .sort()
      .join('|');
    return createHash('sha1').update(ids).digest('hex');
  }
}
