import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { NewsItem } from './news.types';

@Injectable()
export class NewsTranslator {
  private readonly cache = new Map<string, string>(); // id → ru title
  private readonly logger = new Logger(NewsTranslator.name);

  // Счётчик битых переводов для наблюдаемости: «молча вернули оригинал»
  // иначе неотличимо от «перевод не запускался». Растёт → промпт/модель под правку.
  private failCount = 0;

  // Заголовок по id неизменен — кэшируем навсегда. Кэп + FIFO-эвикшн
  // чтобы Map не рос бесконечно за месяцы часовых refresh.
  private readonly MAX_ENTRIES = 500;

  private static readonly SYSTEM =
    'Ты профессиональный переводчик крипто-новостей на русский. ' +
    'Пиши ТОЛЬКО кириллицей и латиницей — никаких иероглифов (китайских, японских, корейских). ' +
    'Тикеры (BTC, ETH, SOL), названия компаний, продуктов и имена людей не переводи.';

  // Хирагана/катакана/кандзи (CJK Unified) + хангыль. Если такое осталось
  // в «переводе» — модель не довела строку до конца, считаем её битой.
  private static readonly CJK = /[　-鿿가-힯]/;

  private isValid(ru: string): boolean {
    return ru.length > 0 && !NewsTranslator.CJK.test(ru);
  }

  constructor(private readonly ai: AiService) {}

  async translate(items: NewsItem[]): Promise<NewsItem[]> {
    const untranslated = items.filter((i) => !this.cache.has(i.id));

    if (untranslated.length > 0) {
      try {
        const translations = await this.batchTranslate(untranslated);
        untranslated.forEach((item, i) => {
          const ru = translations[i]?.trim();
          // Невалидный (пустой/с иероглифами) → не кэшируем, останется
          // оригинал, а следующий refresh попробует перевести заново.
          if (ru && this.isValid(ru)) {
            this.set(item.id, ru);
          } else {
            this.failCount++;
            this.logger.warn(
              `Битый перевод (${this.failCount}): "${item.title.slice(0, 40)}"`,
            );
          }
        });
      } catch (e) {
        this.logger.warn(`Перевод не удался, отдаю оригиналы: ${String(e)}`);
      }
    }

    // Fallback на оригинал, если перевода нет (модель легла или строка пустая)
    return items.map((i) => ({
      ...i,
      title: this.cache.get(i.id) ?? i.title,
    }));
  }

  private async batchTranslate(items: NewsItem[]): Promise<string[]> {
    const numbered = items.map((it, i) => `${i + 1}. ${it.title}`).join('\n');

    const prompt = `Переведи заголовки крипто-новостей на русский.
ВСЕ слова только кириллицей или латиницей. Никаких иероглифов.
"framework" → "фреймворк", не 框架.
Сохрани нумерацию строго 1:1. Верни только перевод, без пояснений и лишних строк.

${numbered}`;

    // ~60 токенов на заголовок с запасом на кириллицу + подушка на разметку
    const maxTokens = Math.min(4096, items.length * 60 + 200);

    const raw = await this.ai.complete(prompt, {
      system: NewsTranslator.SYSTEM,
      maxTokens,
      temperature: 0.2,
    });

    return this.parseNumbered(raw, items.length);
  }

  // Парсим "1. текст\n2. текст" обратно в массив по индексам.
  // Мапим по номеру, а не по совпадению текста: если модель сольёт/переставит
  // строки, недостающие индексы останутся '' → fallback на оригинал.
  private parseNumbered(raw: string, expected: number): string[] {
    const result: string[] = new Array<string>(expected).fill('');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(\d+)\.\s*(.+)$/);
      if (m) {
        const idx = parseInt(m[1], 10) - 1;
        if (idx >= 0 && idx < expected) result[idx] = m[2].trim();
      }
    }
    return result;
  }

  private set(id: string, ru: string): void {
    // FIFO-эвикшн: Map хранит порядок вставки, выкидываем самый старый ключ
    if (this.cache.size >= this.MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(id, ru);
  }
}
