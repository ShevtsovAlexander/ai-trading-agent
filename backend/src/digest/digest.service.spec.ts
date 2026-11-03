/**
 * Свод «Инфополе» (TASK-0012): факты на реальных klines 1h (фикстура curl),
 * модель — подставные ответы (известный ответ), счётчик её вызовов.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { AiService } from '../ai/ai.service';
import { MarketDataService } from '../market/market-data.service';
import { NewsItem } from '../news/news.types';
import { DigestService } from './digest.service';
import { buildFact, factLine, parseHourly } from './market-facts';

const FX = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'hourly-2026-11-03.json'), 'utf8'),
) as { now: number; rows: Record<string, unknown[][]> };

const SYMBOL: Record<string, string> = {
  bitcoin: 'BTCUSDT',
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
};
const MARKET: Record<string, string> = {
  bitcoin: 'BTC/USDT',
  ethereum: 'ETH/USDT',
  solana: 'SOL/USDT',
};
const REGIME = {
  bitcoin: { regime: 'range', days: 17 },
  ethereum: { regime: 'down', days: 26 },
  solana: { regime: 'down', days: 22 },
} as const;

const news = (n: number): NewsItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    title: `Заголовок ${i + 1}: притоки в ETF $250 млн`,
    link: '',
    source: 'Test',
    category: null,
    imageUrl: null,
    publishedAt: '2026-11-03T16:00:00Z',
  }));

const expectedFact = (coinId: keyof typeof REGIME) =>
  buildFact(
    coinId,
    MARKET[coinId],
    parseHourly(FX.rows[SYMBOL[coinId]], FX.now),
    REGIME[coinId],
  );

// Текст из чисел фактов BTC/ETH (77 732, 0,3, 0,96, 17, 1,27) и заголовка — проходит проверку
const GOOD =
  'BTC за 24 ч почти не изменился (+0,30 %), цена 77 732 USDT, объём 0,96 от среднего за 30 дней, боковик 17 дн. ETH +1,27 %. В новостях — притоки в ETF $250 млн.';

const setup = (
  opts: {
    failSymbols?: string[];
    regimeFail?: string[];
    regimeDays?: Partial<Record<string, number>>;
  } = {},
) => {
  const http = {
    get: (_url: string, { params }: { params: { symbol: string } }) =>
      opts.failSymbols?.includes(params.symbol)
        ? throwError(() => new Error('ECONNRESET'))
        : of({ data: FX.rows[params.symbol] }),
  } as unknown as HttpService;
  const marketData = {
    getRegime: jest.fn((coinId: keyof typeof REGIME) =>
      opts.regimeFail?.includes(coinId)
        ? Promise.reject(new Error('Binance недоступен'))
        : Promise.resolve({
            ...REGIME[coinId],
            days: opts.regimeDays?.[coinId] ?? REGIME[coinId].days,
          }),
    ),
  } as unknown as MarketDataService;
  const ai = { complete: jest.fn() };
  const service = new DigestService(
    ai as unknown as AiService,
    http,
    marketData,
  );
  service.clock = () => FX.now;
  // logger.warn — шум в выводе jest
  jest
    .spyOn(
      (service as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);
  return { service, ai, marketData };
};

const promptOf = (ai: { complete: jest.Mock }, call = 0) =>
  (ai.complete.mock.calls[call] as [string, { system: string }])[0];

describe('DigestService — свод из фактов и заголовков', () => {
  it('промпт: строка фактов каждой монеты и заголовки; ответ принят вместе с фактами', async () => {
    const { service, ai } = setup();
    ai.complete.mockResolvedValue(`  ${GOOD}  `);
    const d = await service.generate(news(25));

    const prompt = promptOf(ai);
    for (const c of ['bitcoin', 'ethereum', 'solana'] as const) {
      expect(prompt).toContain(factLine(expectedFact(c)));
    }
    expect(prompt).toContain('1. Заголовок 1: притоки в ETF $250 млн');
    expect(prompt).toContain('20. Заголовок 20');
    expect(prompt).not.toContain('21. Заголовок 21');
    const system = (
      ai.complete.mock.calls[0] as [string, { system: string }]
    )[1].system;
    expect(system).toMatch(/не пиши чисел, которых нет в данных/);
    expect(system).toMatch(/НЕ давай рекомендаций/);
    expect(system).toMatch(/причинно/);

    expect(d).toEqual({
      summary: GOOD,
      generatedAt: new Date(FX.now).toISOString(),
      itemCount: 20,
      market: {
        facts: [
          expectedFact('bitcoin'),
          expectedFact('ethereum'),
          expectedFact('solana'),
        ],
        failed: [],
      },
    });
    expect(service.getDigest()).toBe(d);
  });

  it('та же лента и те же факты — модель не зовётся; факты сменились — зовётся', async () => {
    const { service, ai } = setup({ regimeDays: {} });
    ai.complete.mockResolvedValue(GOOD);
    await service.generate(news(5));
    await service.generate(news(5));
    expect(ai.complete).toHaveBeenCalledTimes(1);

    // Режим BTC перешёл на следующий день — факты другие при той же ленте
    const next = setup({ regimeDays: { bitcoin: 18 } });
    (service as unknown as { marketData: unknown }).marketData = (
      next.service as unknown as { marketData: unknown }
    ).marketData;
    await service.generate(news(5));
    expect(ai.complete).toHaveBeenCalledTimes(2);
  });

  it('пустая лента — свод по рынку (itemCount 0, «Заголовков нет»)', async () => {
    const { service, ai } = setup();
    ai.complete.mockResolvedValue('BTC за 24 ч +0,30 %, боковик 17 дн.');
    const d = await service.generate([]);
    expect(promptOf(ai)).toContain('Заголовков нет — пиши только о рынке.');
    expect(d?.itemCount).toBe(0);
    expect(d?.summary).toBe('BTC за 24 ч +0,30 %, боковик 17 дн.');
  });

  it('пустая лента и ни одной монеты — модель не зовётся, прошлого нет → null', async () => {
    const { service, ai } = setup({
      failSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    });
    expect(await service.generate([])).toBeNull();
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('все монеты упали, лента есть — свод по новостям («Данных рынка нет»)', async () => {
    const { service, ai } = setup({
      failSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    });
    ai.complete.mockResolvedValue('В новостях — притоки в ETF $250 млн.');
    const d = await service.generate(news(3));
    expect(promptOf(ai)).toContain(
      'Данных рынка нет — пиши только о новостях.',
    );
    expect(d?.market).toEqual({
      facts: [],
      failed: ['bitcoin', 'ethereum', 'solana'],
    });
    expect(d?.summary).toBe('В новостях — притоки в ETF $250 млн.');
  });

  it('часы одной монеты упали — она в failed, в промпте её строки нет', async () => {
    const { service, ai } = setup({ failSymbols: ['SOLUSDT'] });
    ai.complete.mockResolvedValue(GOOD);
    const d = await service.generate(news(3));
    expect(d?.market.failed).toEqual(['solana']);
    expect(d?.market.facts.map((f) => f.coinId)).toEqual([
      'bitcoin',
      'ethereum',
    ]);
    expect(promptOf(ai)).not.toMatch(/^SOL:/m);
  });

  it('режим упал — факт с regime null, в промпте «нет данных»', async () => {
    const { service, ai } = setup({ regimeFail: ['ethereum'] });
    ai.complete.mockResolvedValue(GOOD);
    const d = await service.generate(news(3));
    const eth = d?.market.facts.find((f) => f.coinId === 'ethereum');
    expect(eth).toMatchObject({ regime: null, regimeDays: null });
    expect(d?.market.failed).toEqual([]);
    expect(promptOf(ai)).toMatch(
      /^ETH: .*режим по дневным свечам: нет данных$/m,
    );
  });
});

describe('DigestService — проверка ответа и отказ модели', () => {
  it('выдуманное число без прошлого свода — текста нет, факты есть', async () => {
    const { service, ai } = setup();
    ai.complete.mockResolvedValue('BTC вырос на 3,5 % за сутки.');
    const d = await service.generate(news(3));
    expect(d?.summary).toBeNull();
    expect(d?.market.facts).toHaveLength(3);
  });

  it('числа — только из фактов и первых 20 заголовков, не из инструкции промпта', async () => {
    const { service, ai } = setup();
    // При 3 заголовках «4» есть только в инструкции («4–6 предложений»);
    // «21» — в 21-м заголовке, в промпт не вошедшем
    ai.complete.mockResolvedValueOnce('BTC +0,30 %, в своде 4 темы.');
    expect((await service.generate(news(3)))?.summary).toBeNull();
    ai.complete.mockResolvedValueOnce('BTC +0,30 %. Заголовок 21 про ETF.');
    expect((await service.generate(news(26)))?.summary).toBeNull();
    ai.complete.mockResolvedValueOnce('BTC +0,30 %. Заголовок 20 про ETF.');
    expect((await service.generate(news(27)))?.summary).toBe(
      'BTC +0,30 %. Заголовок 20 про ETF.',
    );
  });

  it('процент из заголовка после «вырос» — принят (заголовки передаются в проверку)', async () => {
    const { service, ai } = setup();
    const items = [{ ...news(1)[0], title: 'Биткоин вырос на 5 % за неделю' }];
    ai.complete.mockResolvedValue(
      'По заголовкам, биткоин вырос на 5 % за неделю.',
    );
    expect((await service.generate(items))?.summary).toBe(
      'По заголовкам, биткоин вырос на 5 % за неделю.',
    );
  });

  it('перевёрнутый знак изменения — отвергнуто', async () => {
    const { service, ai } = setup();
    ai.complete.mockResolvedValue('BTC упал на 0,30 % за сутки.');
    expect((await service.generate(news(3)))?.summary).toBeNull();
  });

  it('слово-указание — отвергнуто', async () => {
    const { service, ai } = setup();
    ai.complete.mockResolvedValue('BTC в боковике, стоит купить.');
    expect((await service.generate(news(3)))?.summary).toBeNull();
  });

  it('выдуманное число при прошлом своде — прошлый свод с его фактами', async () => {
    const { service, ai } = setup();
    ai.complete.mockResolvedValueOnce(GOOD);
    const first = await service.generate(news(3));
    ai.complete.mockResolvedValueOnce('BTC вырос на 3,5 %.');
    const second = await service.generate(news(4)); // новая лента — новый вызов
    expect(ai.complete).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  it('модель упала без прошлого — текста нет, факты есть; следующий раз зовётся снова', async () => {
    const { service, ai } = setup();
    ai.complete.mockRejectedValueOnce(new Error('403 Forbidden'));
    const d = await service.generate(news(3));
    expect(d?.summary).toBeNull();
    expect(d?.market.facts).toHaveLength(3);
    expect(service.getDigest()).toBe(d);

    ai.complete.mockResolvedValueOnce(GOOD);
    const again = await service.generate(news(3)); // та же лента и факты
    expect(ai.complete).toHaveBeenCalledTimes(2);
    expect(again?.summary).toBe(GOOD);
  });

  it('модель молчит — как отказ', async () => {
    const { service, ai } = setup();
    ai.complete.mockResolvedValue('   ');
    expect((await service.generate(news(3)))?.summary).toBeNull();
  });
});
