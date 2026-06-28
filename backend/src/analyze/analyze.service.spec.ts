import { Test, TestingModule } from '@nestjs/testing';
import { AnalyzeService } from './analyze.service';
import { PriceService } from '../price/price.service';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PositionService } from '../position/position.service';

const mockPriceService = {
  getPrice: jest.fn(),
  getPreviousPrice: jest.fn(),
  getTrend: jest.fn(),
  getMovingAverage: jest.fn(),
  getEMA: jest.fn(),
  getRSI: jest.fn(),
  getMACD: jest.fn(),
  getBollingerBands: jest.fn(),
  getATR: jest.fn().mockResolvedValue(null),
};

const mockAiService = {
  analyze: jest.fn().mockResolvedValue('AI анализ'),
};

const mockPrismaService = {
  tradeDecision: {
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
};

const mockWalletService = {
  applyDecision: jest.fn().mockResolvedValue({}),
};

const mockPositionService = {
  checkAndUpdatePosition: jest.fn().mockResolvedValue(null),
  getOpenPosition: jest.fn().mockResolvedValue(null),
  openPosition: jest.fn().mockResolvedValue({}),
};

describe('AnalyzeService', () => {
  let service: AnalyzeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyzeService,
        { provide: PriceService, useValue: mockPriceService },
        { provide: AiService, useValue: mockAiService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: WalletService, useValue: mockWalletService },
        { provide: PositionService, useValue: mockPositionService },
      ],
    }).compile();

    service = module.get<AnalyzeService>(AnalyzeService);
    jest.clearAllMocks();
  });

  const setup = (
    price: number,
    previous: number | null,
    options: {
      trend?: 'up' | 'down' | 'flat';
      ma?: number | null;
      ema9?: number | null;
      ema21?: number | null;
      rsi?: number | null;
      macd?: { macd: number; signal: number; histogram: number } | null;
      bb?: {
        upper: number;
        middle: number;
        lower: number;
        bandwidth: number;
      } | null;
    } = {},
  ) => {
    mockPriceService.getPrice.mockResolvedValue(price);
    mockPriceService.getPreviousPrice.mockResolvedValue(previous);
    mockPriceService.getTrend.mockResolvedValue(options.trend ?? 'flat');
    mockPriceService.getMovingAverage.mockResolvedValue(options.ma ?? null);
    mockPriceService.getEMA
      .mockResolvedValueOnce(options.ema9 ?? null)
      .mockResolvedValueOnce(options.ema21 ?? null);
    mockPriceService.getRSI.mockResolvedValue(options.rsi ?? null);
    mockPriceService.getMACD.mockResolvedValue(options.macd ?? null);
    mockPriceService.getBollingerBands.mockResolvedValue(options.bb ?? null);
  };

  it('нет истории цен → SKIP', async () => {
    setup(84000, null);
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result.decision).toBe('SKIP');
  });

  it('изменение меньше порога шума → SKIP', async () => {
    setup(84001, 84000); // 0.001% — меньше 0.2% для bitcoin
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('шум');
  });

  it('EMA + MACD бычьи → BUY (вес 4.0 достигнут)', async () => {
    setup(84000, 80000, {
      ema9: 85000, // EMA9 > EMA21 → +2.0
      ema21: 82000,
      macd: { macd: 100, signal: 50, histogram: 50 }, // бычий → +2.0
      rsi: 50,
      trend: 'flat',
    });
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result.decision).toBe('BUY');
    expect(result.confidence).toBeGreaterThanOrEqual(60);
  });

  it('EMA + MACD медвежьи → SELL (вес 4.0 достигнут)', async () => {
    setup(80000, 84000, {
      ema9: 79000, // EMA9 < EMA21 → +2.0
      ema21: 82000,
      macd: { macd: -100, signal: -50, histogram: -50 }, // медвежий → +2.0
      rsi: 50,
      trend: 'flat',
    });
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result.decision).toBe('SELL');
  });

  it('только один сильный сигнал → SKIP (нет weighted confluence)', async () => {
    setup(84000, 80000, {
      ema9: 85000, // EMA бычий → +2.0
      ema21: 82000,
      macd: { macd: -100, signal: -50, histogram: -50 }, // MACD медвежий → sell +2.0
      rsi: 50,
      trend: 'flat',
    });
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('confluence');
  });

  it('RSI перепродан + EMA + MACD бычьи → высокий confidence', async () => {
    setup(84000, 80000, {
      ema9: 85000,
      ema21: 82000,
      macd: { macd: 100, signal: 50, histogram: 50 },
      rsi: 25, // перепродан → +1.5
      trend: 'up', // тренд → +1.0
    });
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result.decision).toBe('BUY');
    expect(result.confidence).toBeGreaterThan(70);
  });

  it('контрарный сигнал — снижает confidence', async () => {
    setup(84000, 80000, {
      ema9: 85000,
      ema21: 82000,
      macd: { macd: 100, signal: 50, histogram: 50 },
      rsi: 50,
      trend: 'down', // против BUY сигнала
    });
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result.decision).toBe('BUY');
    expect(result.reason).toContain('Контрарный');
  });

  it('динамический порог — solana имеет выше порог шума', async () => {
    setup(100.3, 100, {
      // 0.3% — шум для SOL (порог 0.4%)
      ema9: 101,
      ema21: 99,
      macd: { macd: 1, signal: 0.5, histogram: 0.5 },
    });
    const result = await service.analyze({
      market: 'SOL/USDT',
      coinId: 'solana',
      volume: 1500,
    });
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('шум');
  });

  it('ответ содержит все поля включая macd и bb', async () => {
    setup(84000, 80000, {
      ema9: 85000,
      ema21: 82000,
      macd: { macd: 100, signal: 50, histogram: 50 },
      bb: { upper: 86000, middle: 83000, lower: 80000, bandwidth: 7.2 },
    });
    const result = await service.analyze({
      market: 'BTC/USDT',
      coinId: 'bitcoin',
      volume: 1500,
    });
    expect(result).toHaveProperty('ema9');
    expect(result).toHaveProperty('ema21');
    expect(result).toHaveProperty('rsi');
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('bb');
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('timestamp');
  });
});
