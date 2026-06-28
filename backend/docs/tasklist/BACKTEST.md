# Tasklist: Backtest модуль

## Задачи

- [x] **TASK-1: Типы и DTO**
  Создать `backtest.types.ts` и `backtest.dto.ts`.
  - `RunBacktestDto`: поля `symbol`, `interval`, `days`, `initialBalance`, `atrMultiplier` — все с `@IsString`/`@IsNumber`/`@IsPositive`
  - `BacktestTrade` и `BacktestResult` экспортированы из `backtest.types.ts`
  - Критерий: `import { BacktestResult } from './backtest.types'` компилируется без ошибок

- [x] **TASK-2: Модуль и подключение в app.module.ts**
  Создать `backtest.module.ts` с импортом `HttpModule`, зарегистрировать в `app.module.ts`.
  - `BacktestModule` импортирует `HttpModule` (из `@nestjs/axios`)
  - `AppModule.imports` содержит `BacktestModule`
  - Критерий: `npm run build` проходит без ошибок

- [x] **TASK-3: Загрузка свечей с Binance**
  Реализовать `BacktestService.fetchCandles(symbol, days)` — постраничная загрузка klines.
  - Вычисляет количество свечей: `days * 24 * 60 / 5`
  - Запросы по 1000 свечей, двигая `endTime` назад
  - Задержка 200ms между запросами (`await new Promise(r => setTimeout(r, 200))`)
  - Возвращает массив `Candle[]` отсортированный по возрастанию openTime
  - Критерий: вызов с `symbol='BTCUSDT', days=1` возвращает ~288 свечей (288 = 24*60/5) без ошибок

- [x] **TASK-4: Функции индикаторов (calcEMA, calcRSI)**
  Реализовать `calcEMA` и `calcRSI` как приватные методы `BacktestService`.
  - `calcEMA(prices, period)` → массив длиной `prices.length`, `NaN` для первых `period-1` элементов
  - `calcRSI(prices, period=14)` → массив длиной `prices.length`, `NaN` до накопления данных
  - Критерий: `calcEMA([1,2,3,4,5,6,7,8,9,10], 9)` возвращает массив с NaN[0..7] и числом на индексе 8

- [x] **TASK-5: Функции индикаторов (calcMACD, calcBB, calcATR)**
  Реализовать `calcMACD`, `calcBB`, `calcATR`.
  - `calcMACD(prices)` → `{ macd, signal, histogram }` — каждое поле массив длиной `prices.length`, первые ~33 элемента NaN
  - `calcBB(prices, period=20)` → `{ upper, middle, lower, bandwidth }` — массивы, первые `period-1` NaN
  - `calcATR(highs, lows, closes, period=14)` → массив, первые `period` NaN
  - Критерий: для массива из 50+ элементов все функции возвращают числовое значение на последнем индексе

- [x] **TASK-6: Confluence логика на массиве свечей**
  Реализовать `calcSignal(i, candles, indicators)` — идентично `analyze.service.ts`.
  - Динамический шумовой фильтр по символу: `BTCUSDT=0.2%, ETHUSDT=0.25%, SOLUSDT=0.4%`, остальные 0.3% — идентично `NOISE_THRESHOLD` в `analyze.service.ts`
  - 6 индикаторов с весами: EMA(2.0), MACD(2.0), RSI(1.5), BB(1.5), Trend(1.0), MA5(1.0)
  - Порог 4.0, тренд вычисляется из последних 10 closes
  - Критерий: при `ema9 > ema21` и `macd > signal` и `histogram > 0` (суммарно ≥ 4.0) → возвращает 'BUY'

- [x] **TASK-7: Симуляция позиций**
  Реализовать цикл симуляции в `BacktestService.run()`.
  - Одна позиция одновременно
  - Вход по `open[i+1]` при сигнале на свече `i` (no look-ahead bias)
  - ATR trailing stop двигается ТОЛЬКО при новом хае/лоу: BUY → если `high[i] > position.highPrice` → обновить `highPrice`, затем `stopLoss = max(stopLoss, high[i] - atr[i] * atrMultiplier)`; SELL → аналогично по `lowPrice`
  - Закрытие: `low[i] <= stopLoss` (BUY) или `high[i] >= stopLoss` (SELL)
  - P&L = `(balance / entryPrice) * (exitPrice - entryPrice)` для BUY
  - Критерий: для 1-дневных данных BTC возвращает массив `trades` с корректными `entryTime < exitTime`

- [x] **TASK-8: Расчёт метрик**
  Реализовать `calcMetrics(trades, initialBalance)`.
  - `winRate = wins / totalTrades * 100` (0 если нет сделок)
  - `maxDrawdown` — максимальная просадка по equity curve (в долларах)
  - `sharpeRatio` — `avg(pnls) / std(pnls)`, 0 если std = 0 или нет сделок
  - `totalPnlPct = totalPnl / initialBalance * 100`
  - Критерий: при пустом `trades` все метрики равны 0, `finalBalance = initialBalance`

- [x] **TASK-9: Контроллер POST /backtest/run**
  Создать `backtest.controller.ts` с одним эндпоинтом.
  - `@Post('run')` вызывает `this.backtestService.run(dto)` и возвращает `BacktestResult`
  - Валидация через `ValidationPipe` (уже настроен глобально в `main.ts`)
  - Критерий: `POST /backtest/run` с невалидным body возвращает 400, с корректным — 200 и JSON результат

- [x] **TASK-10: Финальная проверка**
  Убедиться что всё работает end-to-end.
  - `npm run build` — без ошибок TypeScript
  - `npm run test` — 9 существующих тестов проходят
  - `POST /backtest/run` с `{ "symbol": "BTCUSDT", "interval": "5m", "days": 7, "initialBalance": 100, "atrMultiplier": 1.5 }` возвращает корректный JSON с полями `winRate`, `sharpeRatio`, `trades`
  - Критерий: `finalBalance` и `totalPnl` математически согласованы: `finalBalance ≈ initialBalance + totalPnl`
