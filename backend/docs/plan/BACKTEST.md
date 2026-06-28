# Архитектурный план: Backtest модуль

## Компоненты

### Новые файлы
| Файл | Роль |
|------|------|
| `src/backtest/backtest.module.ts` | NestJS модуль, импортирует `HttpModule` |
| `src/backtest/backtest.controller.ts` | `POST /backtest/run` → вызов сервиса |
| `src/backtest/backtest.service.ts` | Вся логика: фетч, индикаторы, симуляция, метрики |
| `src/backtest/backtest.dto.ts` | `RunBacktestDto` с валидацией |
| `src/backtest/backtest.types.ts` | `BacktestResult`, `BacktestTrade` |

### Изменяемые файлы
| Файл | Изменение |
|------|-----------|
| `src/app.module.ts` | Добавить `BacktestModule` в `imports` |

---

## Контракты

### RunBacktestDto
```ts
class RunBacktestDto {
  symbol: string;        // 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'
  interval: string;      // '5m'
  days: number;          // 90
  initialBalance: number; // 100
  atrMultiplier: number; // 1.5
}
```

### BacktestTrade
```ts
interface BacktestTrade {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  pnl: number;           // в долларах, масштабирован по позиции
  entryTime: number;     // unix timestamp ms
  exitTime: number;
}
```

### BacktestResult
```ts
interface BacktestResult {
  symbol: string;
  days: number;
  totalCandles: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;       // wins / totalTrades * 100
  totalPnl: number;
  totalPnlPct: number;   // totalPnl / initialBalance * 100
  maxDrawdown: number;   // максимальная просадка от пика (в долларах)
  sharpeRatio: number;   // avgPnl / stdPnl per trade
  finalBalance: number;
  trades: BacktestTrade[];
}
```

### BacktestService — публичные методы
```ts
async run(dto: RunBacktestDto): Promise<BacktestResult>
```

### BacktestService — внутренние методы
```ts
private async fetchCandles(symbol: string, days: number): Promise<Candle[]>
private calcEMA(prices: number[], period: number): number[]
private calcRSI(prices: number[], period?: number): number[]
private calcMACD(prices: number[]): { macd: number[], signal: number[], histogram: number[] }
private calcBB(prices: number[], period?: number): { upper: number[], middle: number[], lower: number[], bandwidth: number[] }
private calcATR(highs: number[], lows: number[], closes: number[], period?: number): number[]
private calcSignal(i: number, indicators: Indicators): 'BUY' | 'SELL' | 'SKIP'
private calcMetrics(trades: BacktestTrade[], initialBalance: number): Metrics
```

### Candle (внутренний тип)
```ts
interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

---

## Поток данных

```
POST /backtest/run (RunBacktestDto)
  │
  ▼
BacktestController.run()
  │
  ▼
BacktestService.run()
  │
  ├─ fetchCandles(symbol, days)
  │    ├─ Вычислить сколько свечей: days * 24 * 60 / 5 = ~25920 для 90 дней
  │    ├─ Binance: GET /api/v3/klines?...&limit=1000
  │    ├─ Постранично: пока не набрано нужное количество или данные кончились
  │    └─ Задержка 200ms между запросами
  │
  ├─ Вычислить индикаторы (один проход по всем ценам)
  │    ├─ closes = candles.map(c => c.close)
  │    ├─ highs/lows/volumes аналогично
  │    ├─ ema9  = calcEMA(closes, 9)
  │    ├─ ema21 = calcEMA(closes, 21)
  │    ├─ rsi   = calcRSI(closes, 14)
  │    ├─ macd  = calcMACD(closes)
  │    ├─ bb    = calcBB(closes, 20)
  │    └─ atr   = calcATR(highs, lows, closes, 14)
  │
  ├─ Симуляция (WARMUP = 34 свечи — минимум для MACD)
  │    ├─ balance = initialBalance; position = null
  │    ├─ Для каждой свечи i от WARMUP до len-2:
  │    │    ├─ Если есть открытая позиция:
  │    │    │    ├─ Обновить trailing stop ТОЛЬКО при новом хае/лоу:
  │    │    │    │    BUY:  если high[i] > position.highPrice →
  │    │    │    │          position.highPrice = high[i]
  │    │    │    │          stopLoss = max(stopLoss, high[i] - atr[i] * atrMultiplier)
  │    │    │    │    SELL: если low[i] < position.lowPrice →
  │    │    │    │          position.lowPrice = low[i]
  │    │    │    │          stopLoss = min(stopLoss, low[i] + atr[i] * atrMultiplier)
  │    │    │    └─ Если low[i] <= stopLoss (BUY) или high[i] >= stopLoss (SELL) → закрыть
  │    │    └─ Если нет позиции:
  │    │         ├─ signal = calcSignal(i) — по closes и индикаторам на i
  │    │         └─ BUY/SELL → открыть позицию: entryPrice = candles[i+1].open
  │    └─ Финальное закрытие открытой позиции по последнему close
  │
  ├─ calcMetrics(trades, initialBalance)
  │    ├─ winRate, totalPnl, maxDrawdown, sharpeRatio
  │    └─ finalBalance = initialBalance + totalPnl
  │
  └─ return BacktestResult (без записи в БД)
```

---

## Расчёт P&L (позиционный размер)

P&L в долларах с масштабированием по балансу:
```
units = balance / entryPrice   // сколько монет покупаем на текущий баланс
pnl = units * (exitPrice - entryPrice)   // BUY
pnl = units * (entryPrice - exitPrice)   // SELL
balance += pnl
```

Это даёт осмысленный P&L для $100 стартового баланса и BTC по $70k:
- ATR ~$300 × 1.5 = $450 stop distance
- max loss = (100/70000) × 450 ≈ $0.64 = 0.64% риска на сделку

---

## Алгоритм confluence (идентичен analyze.service.ts)

```
// Динамический порог по символу — идентично analyze.service.ts
NOISE_THRESHOLDS = { BTCUSDT: 0.002, ETHUSDT: 0.0025, SOLUSDT: 0.004 }
DEFAULT_NOISE_THRESHOLD = 0.003
noiseThreshold = NOISE_THRESHOLDS[symbol] ?? DEFAULT_NOISE_THRESHOLD

changePct = |close[i] - close[i-1]| / close[i-1]
if changePct < noiseThreshold → SKIP

weightedBuy = weightedSell = 0

// EMA кросс (вес 2.0)
ema9[i] > ema21[i] → buy += 2.0
ema9[i] < ema21[i] → sell += 2.0

// MACD (вес 2.0)
macd[i] > signal[i] && histogram[i] > 0 → buy += 2.0
macd[i] < signal[i] && histogram[i] < 0 → sell += 2.0

// RSI (вес 1.5)
rsi[i] < 35 → buy += 1.5
rsi[i] > 65 → sell += 1.5

// BB (вес 1.5)
bandwidth[i] >= 1:
  close[i] <= lower[i] * 1.001 → buy += 1.5
  close[i] >= upper[i] * 0.999 → sell += 1.5

// Тренд — последние 10 closes (вес 1.0)
trend = calcTrend(closes, i, 10)
trend === 'up'   → buy += 1.0
trend === 'down' → sell += 1.0

// MA5 (вес 1.0)
ma5 = среднее closes[i-4..i]
deviation = (close[i] - ma5) / ma5
deviation < -noiseThreshold → buy += 1.0
deviation > noiseThreshold  → sell += 1.0

// Порог
buy >= 4.0 → BUY; sell >= 4.0 → SELL; иначе → SKIP

// Контрарная коррекция — на confidence (не влияет на сигнал для бэктеста)
// В бэктесте можно пропустить, т.к. confidence не используется в симуляции
```

---

## Метрики

### maxDrawdown
```
peak = initialBalance
maxDrawdown = 0
for each balance в equity curve:
  if balance > peak: peak = balance
  drawdown = peak - balance
  if drawdown > maxDrawdown: maxDrawdown = drawdown
```

### sharpeRatio (упрощённый)
```
pnls = trades.map(t => t.pnl)
avg = mean(pnls)
std = stddev(pnls)
sharpe = std > 0 ? avg / std : 0
```

---

## Риски

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Binance rate limit (1200 req/min) | Низкая | 200ms задержка = ~5 req/s — в пределах лимита |
| Таймаут HTTP (90 дней = 26 запросов × 200ms + latency ≈ 15-20 сек) | Средняя | Не нужен специальный таймаут для NestJS controller (дефолт 0) |
| MACD требует 34+ свечей warmup | Высокая | Явный `WARMUP = 34` константой; симуляция стартует с индекса WARMUP+1 |
| No look-ahead bias — случайное использование future данных | Высокая | Чёткое разделение: сигнал на свече i, вход по open[i+1] |
| Пустой symbol (нет данных на Binance) | Низкая | Проверка количества свечей, ошибка с понятным сообщением |
| Большой trades массив (тысячи сделок) | Низкая | Ограничений нет по ТЗ, клиент должен справиться |

---

## Trade-offs

| Решение | Альтернатива | Почему выбрано |
|---------|--------------|----------------|
| Все индикаторы как приватные методы в BacktestService | Отдельный indicators.ts | Bэктест — единственный потребитель; разделение добавит слой без выгоды |
| Весь расчёт в памяти (~25k свечей × 6 массивов) | Потоковая обработка | ~6 МБ памяти — приемлемо; streaming усложнит код |
| Динамический шумовой порог по символу (BTC 0.2%, ETH 0.25%, SOL 0.4%) | Единый порог | Идентично analyze.service.ts — бэктест должен симулировать реальную стратегию |
| Контрарная коррекция не применяется в симуляции | Применять как в analyze | Коррекция меняет confidence, но не сигнал; в бэктесте confidence не влияет на вход |
| Вход по open[i+1], а не по close[i] | Вход по close[i] | Устраняет look-ahead bias — нельзя торговать по цене закрытия той же свечи, на которой получен сигнал |
| P&L = units × priceDiff (где units = balance/entryPrice) | P&L = raw priceDiff как в position.service | Осмысленный результат для initialBalance $100 |
