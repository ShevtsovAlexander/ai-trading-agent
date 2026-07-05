import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Parser from 'rss-parser';
import { DigestService } from '../digest/digest.service';
import { NewsItem } from './news.types';
import { NewsTranslator } from './news.translator';

type FeedItem = Parser.Item & {
  category?: string;
  'media:content'?: { $?: { url?: string } };
};

interface FeedSource {
  url: string;
  name: string;
}

@Injectable()
export class NewsService implements OnModuleInit {
  private readonly logger = new Logger(NewsService.name);

  private readonly parser: Parser<object, FeedItem> = new Parser({
    timeout: 8000, // мёртвый фид не тормозит refresh
    customFields: {
      item: [['media:content', 'media:content']],
    },
  });

  private cache: NewsItem[] = [];

  constructor(
    private readonly translator: NewsTranslator,
    private readonly digest: DigestService,
  ) {}

  private readonly FEEDS: FeedSource[] = [
    { url: 'https://cointelegraph.com/rss', name: 'Cointelegraph' },
    {
      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
      name: 'Coindesk',
    },
    { url: 'https://decrypt.co/feed', name: 'Decrypt' },
  ];

  onModuleInit(): void {
    // fire-and-forget: прогрев в фоне, старт приложения не блокируется
    void this.refresh();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async refresh(): Promise<void> {
    const results = await Promise.allSettled(
      this.FEEDS.map((f) => this.fetchFeed(f)),
    );

    const seen = new Set<string>();
    const items = results
      .filter(
        (r): r is PromiseFulfilledResult<NewsItem[]> =>
          r.status === 'fulfilled',
      )
      .flatMap((r) => r.value)
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
      .filter((it) => {
        const key = it.title.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 50);

    // Пустой результат не затирает тёплый кэш (все фиды легли)
    if (items.length > 0) {
      // Перевод в фоне refresh: транслятор сам фолбэчит на оригинал при сбое,
      // поэтому await безопасен и getNews() остаётся синхронным.
      const translated = await this.translator.translate(items);
      this.cache = translated;
      this.logger.log(`Обновлено новостей: ${items.length}`);

      // Дайджест по уже переведённой ленте: кэш по хешу id сам решит,
      // звать ли Groq (лента та же → 0 токенов).
      await this.digest.generate(translated);
    }

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.warn(`Фид ${this.FEEDS[i].name}: ${r.reason}`);
      }
    });
  }

  private async fetchFeed(feed: FeedSource): Promise<NewsItem[]> {
    const parsed = await this.parser.parseURL(feed.url);
    return parsed.items.map((item) => this.toNewsItem(item, feed.name));
  }

  // Единая точка нормализации RSS → доменная модель
  private toNewsItem(item: FeedItem, source: string): NewsItem {
    return {
      id: item.guid ?? item.link ?? crypto.randomUUID(),
      title: item.title?.trim() ?? '',
      link: item.link ?? '',
      source,
      category: this.firstCategory(item),
      imageUrl: item['media:content']?.$?.url ?? null,
      publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
    };
  }

  // rss-parser отдаёт any: категория бывает строкой (Cointelegraph)
  // или объектом { _, $ } с атрибутами (Coindesk). Валидируем форму на входе.
  private toCategory(raw: unknown): string | null {
    if (typeof raw === 'string') return raw.trim() || null;
    if (raw && typeof raw === 'object' && '_' in raw) {
      const text = (raw as { _?: unknown })._;
      return typeof text === 'string' ? text.trim() || null : null;
    }
    return null;
  }

  // Берём первую непустую категорию из массива, каждый элемент — через нормализатор
  private firstCategory(item: FeedItem): string | null {
    const raw = item.categories ?? (item.category ? [item.category] : []);
    for (const c of raw) {
      const norm = this.toCategory(c);
      if (norm) return norm;
    }
    return null;
  }

  getNews(): NewsItem[] {
    return this.cache;
  }
}
