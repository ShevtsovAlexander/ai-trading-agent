/**
 * NewsTranslator (TASK-0013): батч перевода идёт со своим таймаутом 60 с —
 * общий таймаут клиента Groq 20 с для 50 заголовков мал (критик T3).
 */
import { AiService } from '../ai/ai.service';
import { NewsItem } from './news.types';
import { NewsTranslator } from './news.translator';

const item = (i: number): NewsItem => ({
  id: `id-${i}`,
  title: `Title ${i}`,
  link: '',
  source: 'Test',
  category: null,
  imageUrl: null,
  publishedAt: '2026-11-03T16:00:00Z',
});

describe('NewsTranslator', () => {
  it('батч — с timeoutMs 60 000 и переводом по номерам', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue('1. Заголовок 1\n2. Заголовок 2');
    const t = new NewsTranslator({ complete } as unknown as AiService);
    const out = await t.translate([item(1), item(2)]);
    expect((complete.mock.calls as unknown[][])[0][1]).toMatchObject({
      timeoutMs: 60_000,
    });
    expect(out.map((i) => i.title)).toEqual(['Заголовок 1', 'Заголовок 2']);
  });
});
