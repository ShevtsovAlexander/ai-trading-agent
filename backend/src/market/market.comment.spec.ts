import { Test, TestingModule } from '@nestjs/testing';
import { MarketComment } from './market.comment';
import { AiService } from '../ai/ai.service';
import { MarketView, SeriesPoint } from './market.types';

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

  // ---------------------------------------------------------------------
  // describeView — кэш и fallback'и при отказе модели + интервал и прошлые
  // значения в промпте, кэш по монете+интервалу
  // ---------------------------------------------------------------------
  const point = (i: number, overrides: Partial<SeriesPoint> = {}) => ({
    t: Date.UTC(2026, 9, 20, 15, i * 5),
    close: 86000 + i * 10,
    ema9: 85900 + i,
    ema21: 85800 + i,
    rsi: 50 + i,
    macd: -272.53,
    macdSignal: -277.21,
    macdHistogram: 4.68 + i,
    bbUpper: 88000,
    bbMiddle: 85000,
    bbLower: 82000,
    bbBandwidth: 6.3,
    ...overrides,
  });

  const view = (overrides: Partial<MarketView> = {}): MarketView => {
    const recent = [0, 1, 2, 3, 4].map((i) => point(i));
    return {
      coinId: 'bitcoin',
      market: 'BTC/USDT',
      interval: '5m',
      closedAt: recent[4].t + 5 * 60 * 1000 - 1,
      price: recent[4].close,
      previousPrice: recent[3].close,
      ma5: 86020,
      trend: 'up',
      latest: recent[4],
      recent,
      aiComment: null,
      ...overrides,
    };
  };

  describe('describeView', () => {
    it('факты не изменились → модель вызвана один раз', async () => {
      mockAiService.complete.mockResolvedValue('Рынок спокоен.');

      const first = await service.describeView(view());
      const second = await service.describeView(view());

      expect(mockAiService.complete).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('факт в прошлой свече изменился → модель вызвана второй раз', async () => {
      mockAiService.complete
        .mockResolvedValueOnce('RSI растёт.')
        .mockResolvedValueOnce('RSI просел и вернулся.');

      await service.describeView(view());
      const changed = view();
      changed.recent = changed.recent.map((p, i) =>
        i === 1 ? { ...p, rsi: 21.4 } : p,
      );
      const second = await service.describeView(changed);

      expect(mockAiService.complete).toHaveBeenCalledTimes(2);
      expect(second).toBe('RSI просел и вернулся.');
    });

    it('модель упала → отдаётся прошлый комментарий, не исключение', async () => {
      mockAiService.complete.mockResolvedValueOnce('Полосы сжаты.');
      const first = await service.describeView(view());

      mockAiService.complete.mockRejectedValueOnce(new Error('groq 503'));
      const second = await service.describeView(view({ price: 86500 }));

      // Счётчик — по той же причине, что в describe: без него кейс зелёный
      // и при цене вне хеша (второй вызов попал бы в кэш)
      expect(mockAiService.complete).toHaveBeenCalledTimes(2);
      expect(second).toBe(first);
    });

    it('кэш по монете: одинаковые факты у разных монет не делят запись', async () => {
      mockAiService.complete
        .mockResolvedValueOnce('Комментарий по биткоину.')
        .mockResolvedValueOnce('Комментарий по эфиру.');

      const btc = await service.describeView(view());
      const eth = await service.describeView(view({ coinId: 'ethereum' }));

      expect(mockAiService.complete).toHaveBeenCalledTimes(2);
      expect(btc).toBe('Комментарий по биткоину.');
      expect(eth).toBe('Комментарий по эфиру.');
    });

    it('модель молчит при наличии истории → прошлый комментарий', async () => {
      mockAiService.complete.mockResolvedValueOnce('Полосы сжаты.');
      const first = await service.describeView(view());

      mockAiService.complete.mockResolvedValueOnce('   ');
      const second = await service.describeView(view({ trend: 'down' }));

      expect(mockAiService.complete).toHaveBeenCalledTimes(2);
      expect(second).toBe(first);
    });

    it('без истории комментария и молчащая модель → null', async () => {
      mockAiService.complete.mockResolvedValue('');

      expect(await service.describeView(view())).toBeNull();
    });

    it('в промпте интервал и ряды слева направо от старой к последней, в system — запрет динамики сверх данных', async () => {
      mockAiService.complete.mockResolvedValue('Текст.');
      await service.describeView(view({ interval: '15m' }));

      const [prompt, opts] = mockAiService.complete.mock.calls[0] as [
        string,
        { system: string },
      ];
      expect(prompt).toContain('свечи 15 минут');
      expect(prompt).toContain(
        'Цена, $: 86000 → 86010 → 86020 → 86030 → 86040 (за 5 свечей: рост на 40)',
      );
      expect(prompt).toContain(
        'RSI: 50 → 51 → 52 → 53 → 54 (за 5 свечей: рост на 4)',
      );
      expect(prompt).toContain(
        'Ширина полос Боллинджера, %: 6.3 → 6.3 → 6.3 → 6.3 → 6.3 (за 5 свечей: без изменений)',
      );
      // Запрет — по смыслу, а не дословно: ограничение приведёнными
      // данными и опора на посчитанные изменения
      expect(opts.system).toMatch(/только по приведённым данным/);
      expect(opts.system).toMatch(/не пересчитывай/);
    });

    // Известный ответ — арифметика. Ряды — живой BTC 1d (2026-10-20), на
    // котором модель назвала −530.63 → −400.52 «снижением»: изменение
    // считает код, со знаком разности, а не «к нулю/от нуля».
    it('изменения посчитаны кодом: отрицательный рост, снижение, пересечение EMA, нет данных', async () => {
      mockAiService.complete.mockResolvedValue('Текст.');
      const hist = [-530.63, -532.38, -520.4, -451.42, -400.52];
      const closes = [82245.93, 81615.64, 81491.04, 82116, 81938.4];
      const ema9 = [2393, 2394, 2395, 2396, 2402];
      const ema21 = [2399, 2399, 2399, 2399, 2399];
      const recent = [0, 1, 2, 3, 4].map((i) =>
        point(i, {
          close: closes[i],
          macdHistogram: hist[i],
          ema9: ema9[i],
          ema21: ema21[i],
          rsi: i === 0 ? null : 50,
        }),
      );
      await service.describeView(view({ recent, latest: recent[4] }));

      const [prompt] = mockAiService.complete.mock.calls[0] as [string];
      expect(prompt).toContain(
        'MACD histogram: -530.63 → -532.38 → -520.4 → -451.42 → -400.52 (за 5 свечей: рост на 130.11)',
      );
      expect(prompt).toContain(
        'Цена, $: 82245.93 → 81615.64 → 81491.04 → 82116 → 81938.4 (за 5 свечей: снижение на 307.53)',
      );
      expect(prompt).toContain(
        'EMA9 относительно EMA21: ниже → ниже → ниже → ниже → выше',
      );
      expect(prompt).toContain(
        'RSI: нет данных → 50 → 50 → 50 → 50 (за 5 свечей: нет данных)',
      );
    });

    // Факты одинаковые, интервалы разные. Запись на монету (без интервала)
    // затёрлась бы 1h и третий вызов снова пошёл бы в модель.
    it('разные интервалы — разные записи кэша', async () => {
      mockAiService.complete
        .mockResolvedValueOnce('Про 5 минут.')
        .mockResolvedValueOnce('Про час.');

      const m5 = await service.describeView(view());
      const h1 = await service.describeView(view({ interval: '1h' }));
      const again = await service.describeView(view());

      expect(mockAiService.complete).toHaveBeenCalledTimes(2);
      expect(m5).toBe('Про 5 минут.');
      expect(h1).toBe('Про час.');
      expect(again).toBe('Про 5 минут.');
    });
  });
});
