import { Test, TestingModule } from '@nestjs/testing';
import { MarketSnapshot } from '@prisma/client';
import { MarketComment } from './market.comment';
import { AiService } from '../ai/ai.service';

const mockAiService = {
  complete: jest.fn(),
};

describe('MarketComment', () => {
  let service: MarketComment;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketComment,
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    // Новый инстанс на каждый тест: кэш — состояние объекта,
    // иначе тесты протекали бы друг в друга.
    service = module.get<MarketComment>(MarketComment);
    // mockReset, а не mockClear: снимает и очередь mockResolvedValueOnce
    mockAiService.complete.mockReset();
  });

  const snapshot = (
    overrides: Partial<MarketSnapshot> = {},
  ): MarketSnapshot => ({
    id: 1,
    market: 'BTC/USDT',
    coinId: 'bitcoin',
    currentPrice: 86000,
    previousPrice: 85000,
    movingAverage: 84000,
    ema9: 83000,
    ema21: 82000,
    rsi: 33.62,
    macdValue: -272.53,
    macdSignal: -277.21,
    macdHistogram: 4.68,
    bbUpper: 88000,
    bbMiddle: 85000,
    bbLower: 82000,
    bbBandwidth: 6.3,
    trend: 'flat',
    createdAt: new Date('2026-10-06T10:35:00.668Z'),
    ...overrides,
  });

  it('факты не изменились → модель вызвана один раз', async () => {
    mockAiService.complete.mockResolvedValue('Рынок спокоен.');

    const first = await service.describe(snapshot());
    const second = await service.describe(snapshot());

    expect(mockAiService.complete).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  // Без этого теста кэш, который всегда отдаёт сохранённое и никогда не
  // зовёт модель, прошёл бы проверку выше.
  it('факт изменился → модель вызвана второй раз', async () => {
    mockAiService.complete
      .mockResolvedValueOnce('RSI в середине диапазона.')
      .mockResolvedValueOnce('RSI ушёл в зону перепроданности.');

    await service.describe(snapshot());
    const second = await service.describe(snapshot({ rsi: 21.4 }));

    expect(mockAiService.complete).toHaveBeenCalledTimes(2);
    expect(second).toBe('RSI ушёл в зону перепроданности.');
  });

  it('модель упала → отдаётся прошлый комментарий, не исключение', async () => {
    mockAiService.complete.mockResolvedValueOnce('Полосы сжаты.');
    const first = await service.describe(snapshot());

    mockAiService.complete.mockRejectedValueOnce(new Error('groq 503'));
    const second = await service.describe(snapshot({ currentPrice: 86500 }));

    // Счётчик обязателен: без него кейс зелёный и тогда, когда
    // currentPrice не входит в хеш — второй вызов просто попадает в кэш,
    // mockRejectedValueOnce остаётся непотреблённым, а second === first
    // выполняется по совсем другой причине.
    expect(mockAiService.complete).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  // Закрывает Map<coinId, …> из trade-off 4 плана и критерий 14 PRD.
  // Факты у двух монет здесь СПЕЦИАЛЬНО одинаковые: только так видно, что
  // ключ кэша — монета, а не хеш фактов. Одногнёздный кэш (как в
  // digest.service.ts) отдал бы на вторую монету чужой комментарий.
  it('кэш по монете: одинаковые факты у разных монет не делят запись', async () => {
    mockAiService.complete
      .mockResolvedValueOnce('Комментарий по биткоину.')
      .mockResolvedValueOnce('Комментарий по эфиру.');

    const btc = await service.describe(snapshot());
    const eth = await service.describe(snapshot({ coinId: 'ethereum' }));

    expect(mockAiService.complete).toHaveBeenCalledTimes(2);
    expect(btc).toBe('Комментарий по биткоину.');
    expect(eth).toBe('Комментарий по эфиру.');
  });

  // Та половина ветки «модель молчит», которую T5 требует по образцу
  // digest.service.ts:33: пустой ответ при НАЛИЧИИ истории.
  it('модель молчит при наличии истории → прошлый комментарий', async () => {
    mockAiService.complete.mockResolvedValueOnce('Полосы сжаты.');
    const first = await service.describe(snapshot());

    mockAiService.complete.mockResolvedValueOnce('   ');
    const second = await service.describe(snapshot({ rsi: 21.4 }));

    expect(mockAiService.complete).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  it('снимок без истории комментария и молчащая модель → null', async () => {
    mockAiService.complete.mockResolvedValue('');

    expect(await service.describe(snapshot())).toBeNull();
  });
});
