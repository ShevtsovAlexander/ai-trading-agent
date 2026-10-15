/**
 * Связка «выборка из БД → расчёт» в PriceService против technicalindicators.
 * Формулы сверяет indicators.spec.ts; здесь проверяется, что сервис берёт
 * СВЕЖИЕ строки в хронологическом порядке, а не самые старые (TASK-0002).
 *
 * Запуск: npm run test -- price.service
 */

import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import * as ti from 'technicalindicators';
import { PriceService } from './price.service';
import { PrismaService } from '../prisma/prisma.service';

interface Row {
  coinId: string;
  price: number;
  createdAt: Date;
}

interface FindManyArgs {
  where: { coinId: string };
  orderBy: { createdAt: 'asc' | 'desc' };
  take?: number;
}

// Фейк обязан честно применять where/orderBy/take: фейк, отдающий строки
// в порядке вставки, не отличит asc от desc и будет зелёным на баге.
const fakePrisma = (rows: Row[]) => ({
  priceSnapshot: {
    findMany: ({ where, orderBy, take }: FindManyArgs) => {
      const dir = orderBy.createdAt === 'asc' ? 1 : -1;
      const result = rows
        .filter((r) => r.coinId === where.coinId)
        .sort((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()));
      return Promise.resolve(
        take === undefined ? result : result.slice(0, take),
      );
    },
  },
});

const COIN = 'bitcoin';
const START = Date.UTC(2026, 9, 1);
const STEP_MS = 5 * 60 * 1000;

// Тренд + синусоида: окно из старых строк даёт заметно другие числа, чем из свежих
const series = (length: number) =>
  Array.from({ length }, (_, i) =>
    parseFloat((60000 + i * 50 + Math.sin(i * 0.4) * 800).toFixed(2)),
  );

const rowsFor = (prices: number[]): Row[] => {
  const own = prices.map((price, i) => ({
    coinId: COIN,
    price,
    createdAt: new Date(START + i * STEP_MS),
  }));
  // Чужая монета вперемешку — проверка фильтра по coinId
  const other = prices.map((_, i) => ({
    coinId: 'ethereum',
    price: 3000 + i,
    createdAt: new Date(START + i * STEP_MS + 1000),
  }));
  // Перемешиваем детерминированно, чтобы порядок вставки ни на что не влиял
  return [...own, ...other].sort(
    (a, b) => ((a.price * 7919) % 101) - ((b.price * 7919) % 101),
  );
};

const makeService = async (rows: Row[]): Promise<PriceService> => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PriceService,
      { provide: HttpService, useValue: {} },
      { provide: PrismaService, useValue: fakePrisma(rows) },
    ],
  }).compile();
  return module.get<PriceService>(PriceService);
};

// Сервис округляет до 2 знаков → расхождение до 0.005
const ROUNDED = 0.005 + 1e-9;
// RSI округляют обе стороны — на границе .xx5 float может развести на 0.01
const BOTH_ROUNDED = 0.01 + 1e-9;

const last = <T>(arr: T[]): T => arr[arr.length - 1];

describe('PriceService — индикаторы по свежим строкам', () => {
  const WINDOW = 100;
  const prices = series(200);
  // Эталон: последние WINDOW цен в хронологическом порядке
  const fresh = prices.slice(-WINDOW);
  let service: PriceService;

  beforeEach(async () => {
    service = await makeService(rowsFor(prices));
  });

  [9, 21].forEach((period) => {
    it(`getEMA(${period}) = ti.EMA на последних ${WINDOW} ценах`, async () => {
      const expected = last(ti.EMA.calculate({ period, values: fresh }));
      const actual = await service.getEMA(COIN, period);

      expect(actual).not.toBeNull();
      expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(ROUNDED);
    });
  });

  it(`getRSI(14) = ti.RSI на последних ${WINDOW} ценах`, async () => {
    const expected = last(ti.RSI.calculate({ period: 14, values: fresh }));
    const actual = await service.getRSI(COIN);

    expect(actual).not.toBeNull();
    expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(BOTH_ROUNDED);
  });

  it(`getMACD = ti.MACD на последних ${WINDOW} ценах`, async () => {
    const expected = last(
      ti.MACD.calculate({
        values: fresh,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      }),
    );
    const actual = await service.getMACD(COIN);

    expect(actual).not.toBeNull();
    expect(Math.abs(actual!.macd - expected.MACD!)).toBeLessThanOrEqual(
      ROUNDED,
    );
    expect(Math.abs(actual!.signal - expected.signal!)).toBeLessThanOrEqual(
      ROUNDED,
    );
    expect(
      Math.abs(actual!.histogram - expected.histogram!),
    ).toBeLessThanOrEqual(ROUNDED);
  });
});

describe('PriceService — нехватка данных', () => {
  const at = async (length: number) => makeService(rowsFor(series(length)));

  it('getEMA(9): 8 строк → null, 9 → число', async () => {
    expect(await (await at(8)).getEMA(COIN, 9)).toBeNull();
    expect(await (await at(9)).getEMA(COIN, 9)).not.toBeNull();
  });

  it('getRSI(14): 14 строк → null, 15 → число', async () => {
    expect(await (await at(14)).getRSI(COIN)).toBeNull();
    expect(await (await at(15)).getRSI(COIN)).not.toBeNull();
  });

  it('getMACD: 33 строки → null, 34 → число', async () => {
    expect(await (await at(33)).getMACD(COIN)).toBeNull();
    expect(await (await at(34)).getMACD(COIN)).not.toBeNull();
  });
});
