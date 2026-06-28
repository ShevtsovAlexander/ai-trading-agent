# Задача: реализовать модуль бэктестинга

## Что нужно создать
Новый NestJS модуль src/backtest/ со следующими файлами:
- backtest.module.ts
- backtest.controller.ts — POST /backtest/run
- backtest.service.ts
- backtest.dto.ts
- backtest.types.ts

## Источник данных
Binance Klines API (без ключа):
GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1000
Одна свеча: [openTime, open, high, low, close, volume, closeTime, ...]
Нужно постранично загрузить свечи за 90 дней (~26000 штук по 1000 за запрос)
Между запросами задержка 200ms чтобы не получить rate limit

## Входные параметры POST /backtest/run
{
symbol: string,         // 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'
interval: string,       // '5m'
days: number,           // 90
initialBalance: number, // 100
atrMultiplier: number,  // 1.5
}

## Индикаторы — считать на массиве свечей (НЕ из БД)
Реализовать локальные функции (не методы PriceService — они работают с БД):
- calcEMA(prices: number[], period: number): number[]
- calcRSI(prices: number[], period = 14): number[]
- calcMACD(prices: number[]): { macd: number[], signal: number[], histogram: number[] }
- calcBB(prices: number[], period = 20): { upper: number[], middle: number[], lower: number[], bandwidth: number[] }
- calcATR(highs: number[], lows: number[], closes: number[], period = 14): number[]

## Логика стратегии — та же что в analyze.service.ts
Weighted confluence порог 4.0:
- EMA кросс (вес 2.0): EMA9 > EMA21 → BUY, EMA9 < EMA21 → SELL
- MACD (вес 2.0): macd > signal && histogram > 0 → BUY
- RSI (вес 1.5): RSI < 35 → BUY, RSI > 65 → SELL
- BB (вес 1.5): цена у нижней полосы → BUY, у верхней → SELL
- Тренд (вес 1.0): последние 10 свечей up/down
- MA5 (вес 1.0): цена ниже MA5 → BUY сигнал

Шумовой фильтр: |changePct| < 0.2% → SKIP (для всех символов в бэктесте)

## Симуляция позиций
- Одна позиция одновременно
- Стоп = ATR * atrMultiplier от цены входа
- Trailing stop: при новом хае (BUY) стоп = price - ATR * atrMultiplier
- Закрытие: стоп пробит на следующей свече (no look-ahead bias)
- P&L считается в абсолютных числах (не в % от баланса)

## Результат (JSON, не сохранять в БД)
{
symbol: string,
days: number,
totalCandles: number,
totalTrades: number,
wins: number,
losses: number,
winRate: number,         // wins / totalTrades * 100
totalPnl: number,
totalPnlPct: number,     // totalPnl / initialBalance * 100
maxDrawdown: number,     // максимальная просадка от пика
sharpeRatio: number,     // упрощённый: avgReturn / stdReturn
finalBalance: number,
trades: Array<{
type: 'BUY' | 'SELL',
entryPrice: number,
exitPrice: number,
pnl: number,
entryTime: number,
exitTime: number,
}>
}

## Важно
- Не сохранять в БД
- Подключить в app.module.ts
- @nestjs/axios уже установлен
- Задержка между Binance запросами 200ms (rate limit)
- no look-ahead bias: решение на свече N, вход по open свечи N+1

## Tasklist

- [ ] backtest.module.ts создан
- [ ] backtest.dto.ts с входными параметрами
- [ ] backtest.types.ts с типом результата
- [ ] Загрузка свечей с Binance постранично
- [ ] Локальные функции индикаторов (calcEMA, calcRSI, calcMACD, calcBB, calcATR)
- [ ] Confluence логика идентична analyze.service.ts
- [ ] Симуляция позиций с ATR trailing stop
- [ ] Расчёт метрик (winRate, maxDrawdown, sharpeRatio)
- [ ] backtest.controller.ts с POST /backtest/run
- [ ] Модуль подключён в app.module.ts

## Результаты бэктеста (90 дней, BTCUSDT)

### Вывод: стратегия убыточна, нужен рефакторинг

| Порог | Сделки | winRate | P&L    | Sharpe |
|-------|--------|---------|--------|--------|
| 4.0   | 205    | 36.1%   | -35%   | -0.21  |
| 5.0   | 159    | 36.5%   | -29%   | -0.24  |
| 6.0   | 37     | 37.8%   | -12%   | -0.41  |
| 7.0   | 0      | —       | 0%     | —      |

### Диагноз
winRate застрял на ~37% независимо от порога — проблема не в шуме входов,
а в самой логике confluence.

Причина: смешаны несовместимые индикаторы.
- Трендовые (вход ПО тренду): EMA кросс, MACD, тренд
- Контртрендовые (вход ПРОТИВ): RSI перепродан, BB нижняя полоса

RSI говорит "перепродан, покупай" когда цена падает.
EMA/тренд в этот момент говорят "вниз, продавай". Конфликт сигналов.

### Следующий шаг
Рефакторинг на чистую трендовую стратегию (Путь А):
- Сигналы входа: только EMA + MACD + тренд
- RSI/BB перевести в фильтры (не входить при экстремумах), не в сигналы
- Диагностика: добавить direction параметр (BUY/SELL/BOTH) чтобы понять
  какое направление убыточно

## Рефакторинг v2: чистая трендовая стратегия

### Диагностика (раздельно по направлению)
- BUY only: 35% win, -28.7%
- SELL only: 39% win, -14.3%
  Оба убыточны → проблема в логике входа, не в направлении.

### Новая логика входа (trend-following)
Сигнал = только трендовые индикаторы:
- EMA9 vs EMA21 (вес 2.0)
- MACD (вес 2.0)
- тренд (вес 1.0)
- порог 4.0 из макс 5.0

RSI и BB переведены в ФИЛЬТРЫ:
- BUY заблокирован если RSI > 70 или цена выше верхней BB
- SELL заблокирован если RSI < 30 или цена ниже нижней BB