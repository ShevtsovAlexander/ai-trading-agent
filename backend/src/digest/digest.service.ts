import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { createHash } from 'crypto';
import { AiService } from '../ai/ai.service';
import { MarketDataService } from '../market/market-data.service';
import { COINS } from '../market/market.types';
import { NewsItem } from '../news/news.types';
import { checkSummary } from './check';
import { buildFact, factLine, fetchHourly } from './market-facts';
import { Digest, MarketFact } from './digest.types';

// Свод «Инфополе» (TASK-0012): факты рынка, посчитанные кодом, + заголовки →
// модель пишет один абзац → код проверяет ответ (числа только из данных, без
// указаний). Текст всегда отдаётся вместе с фактами, по которым написан.
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  // Кэш по хешу ленты И фактов: та же лента при новых фактах — новый свод
  private cached: { hash: string; digest: Digest } | null = null;

  // Часы — поле, чтобы тест мог задать «сейчас» фикстуры
  clock: () => number = Date.now;

  private static readonly SYSTEM =
    'Ты крипто-аналитик. Пишешь краткий свод на русском: что было с рынком ' +
    'за сутки и о чём новости. Только факты из приведённых данных и ' +
    'заголовков, без домыслов. Числа бери только из данных и пиши их как ' +
    'есть; не пиши чисел, которых нет в данных, — ни дат, ни подсчётов, ни ' +
    'округлений. Не связывай новости и движение цены причинно («из-за», ' +
    '«потому что»): ставь рядом, не объясняй. НЕ давай рекомендаций и НЕ ' +
    'предлагай действий: ни «купить», ни «продать», ни «войти», ни ' +
    '«стоит»/«не стоит». Тикеры и имена не переводи. ' +
    // gpt-oss — reasoning-модель: без явного запрета вписывает ход мыслей в ответ
    'Отвечай только готовым текстом свода, без рассуждений, пояснений и ' +
    'вводных фраз. Обычный текст без markdown-разметки (без **, ##, списков ' +
    'со звёздочками).';

  constructor(
    private readonly ai: AiService,
    private readonly http: HttpService,
    private readonly marketData: MarketDataService,
  ) {}

  // Вызывается из NewsService.refresh() раз в час — и при пустой ленте
  async generate(items: NewsItem[]): Promise<Digest | null> {
    const market = await this.collectFacts();
    if (items.length === 0 && market.facts.length === 0) {
      return this.cached?.digest ?? null;
    }

    const hash = this.hash(items, market.facts);
    if (this.cached?.hash === hash) return this.cached.digest; // всё то же

    const prompt = this.buildPrompt(items, market.facts);
    const fresh = (summary: string | null): Digest => ({
      summary,
      generatedAt: new Date(this.clock()).toISOString(),
      itemCount: Math.min(items.length, 20),
      market,
    });

    let summary: string | null = null;
    try {
      const text = (
        await this.ai.complete(prompt, {
          system: DigestService.SYSTEM,
          maxTokens: 500,
          temperature: 0.3,
        })
      ).trim();
      if (text) {
        // Числа — только из строк фактов и текстов заголовков, без нумерации
        // и инструкции промпта (критик T1–T3)
        const titles = items
          .slice(0, 20)
          .map((it) => it.title)
          .join('\n');
        const allowed = [...market.facts.map(factLine), titles].join('\n');
        const check = checkSummary(
          text,
          allowed,
          market.facts.map((f) => f.change24hPct),
          titles,
        );
        if (check.ok) summary = text;
        else this.logger.warn(`Свод отвергнут: ${check.reason}`);
      }
    } catch (e) {
      this.logger.warn(`Свод не сгенерён: ${String(e)}`);
    }

    if (summary !== null) {
      const digest = fresh(summary);
      this.cached = { hash, digest };
      return digest;
    }
    // Текста нет: прошлый свод с его фактами (пара не рвётся), а без прошлого
    // текста — текущие факты без текста. Не кэшируем по хешу: следующий час
    // повторит попытку.
    if (this.cached?.digest.summary) return this.cached.digest;
    const bare = fresh(null);
    this.cached = { hash: '', digest: bare };
    return bare;
  }

  getDigest(): Digest | null {
    return this.cached?.digest ?? null;
  }

  // Факты трёх монет: часы — обязательно (упали → монета в failed), режим —
  // нет (упал → regime: null). Монеты независимы (allSettled).
  private async collectFacts(): Promise<Digest['market']> {
    const now = this.clock();
    const ids = Object.keys(COINS);
    const results = await Promise.allSettled(
      ids.map(async (coinId) => {
        const coin = COINS[coinId];
        const [hours, regime] = await Promise.all([
          fetchHourly(this.http, coin.symbol, now),
          this.marketData.getRegime(coinId).then(
            (r) => ({ regime: r.regime, days: r.days }),
            (e: unknown) => {
              this.logger.warn(`Режим ${coinId} для свода: ${String(e)}`);
              return null;
            },
          ),
        ]);
        return buildFact(coinId, coin.market, hours, regime);
      }),
    );
    const facts: MarketFact[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') facts.push(r.value);
      else {
        failed.push(ids[i]);
        this.logger.warn(`Факты ${ids[i]} для свода: ${String(r.reason)}`);
      }
    });
    return { facts, failed };
  }

  private buildPrompt(items: NewsItem[], facts: MarketFact[]): string {
    // Топ-20 свежих заголовков — свод про главное, экономия токенов
    const headlines = items
      .slice(0, 20)
      .map((it, i) => `${i + 1}. ${it.title}`)
      .join('\n');
    const market =
      facts.length > 0
        ? facts.map(factLine).join('\n')
        : 'Данных рынка нет — пиши только о новостях.';
    const news = headlines || 'Заголовков нет — пиши только о рынке.';

    return `Напиши свод одним абзацем, 4–6 предложений: сначала что было с рынком за сутки, затем о чём новости.
Числа — только из данных ниже, как есть. Не связывай новости и цену причинно. Без вводных.

Данные рынка (посчитаны кодом по часовым свечам Binance; объём — к среднему суточному за 30 дней):
${market}

Заголовки:
${news}`;
  }

  private hash(items: NewsItem[], facts: MarketFact[]): string {
    const ids = items
      .map((i) => i.id)
      .sort()
      .join('|');
    return createHash('sha1')
      .update(ids + '\n' + JSON.stringify(facts))
      .digest('hex');
  }
}
