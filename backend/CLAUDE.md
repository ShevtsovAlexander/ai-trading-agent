# AI Trading Agent — Backend

## Что это
NestJS backend для AI trading агента.
Анализирует крипторынок через технические индикаторы и возвращает торговые решения с управлением позициями.

## Цель проекта
Построить систему: AI agent → backend → data sources → UI dashboard
Долгосрочная цель: $100 → $10,000 через математическое преимущество и контроль риска.

## Стек
- NestJS 11 (TypeScript)
- @nestjs/axios — HTTP запросы к внешним API
- @nestjs/config — переменные окружения
- @nestjs/schedule — cron задачи
- class-validator — валидация входящих данных
- groq-sdk — AI через Groq (llama-3.3-70b-versatile)
- Prisma 7 + @prisma/adapter-pg — ORM для PostgreSQL
- CoinGecko API — реальные цены криптовалют (бесплатно, без ключа)

## Структура проекта
src/
├── ai/
│   ├── ai.module.ts
│   └── ai.service.ts            — Groq клиент, метод analyze()
├── analyze/
│   ├── analyze.controller.ts    — POST /analyze, GET /analyze/decisions/:coinId
│   ├── analyze.dto.ts           — { market, coinId, volume }
│   ├── analyze.module.ts
│   ├── analyze.service.ts       — weighted confluence логика + позиции + сохранение
│   └── analyze.service.spec.ts  — 9 тестов
├── news/
│   ├── news.controller.ts       — GET /news
│   ├── news.module.ts
│   ├── news.service.ts          — RSS-фиды (Cointelegraph, Coindesk, Decrypt), cron каждый час, дедуп, кэш
│   └── news.types.ts            — NewsItem
├── position/
│   ├── position.controller.ts   — GET /positions, GET /positions/:coinId, GET /positions/:coinId/open
│   ├── position.module.ts
│   └── position.service.ts      — открытие/закрытие позиций, trailing stop
├── price/
│   ├── price.controller.ts      — GET /price/:coinId, GET /price/history/:coinId
│   ├── price.module.ts
│   ├── price.scheduler.ts       — cron каждые 5 минут → анализ всех монет
│   └── price.service.ts         — CoinGecko + EMA/RSI/MACD/BB/MA5/тренд
├── prisma/
│   ├── prisma.module.ts         — @Global(), экспортирует PrismaService
│   └── prisma.service.ts        — PrismaClient + @prisma/adapter-pg
├── wallet/
│   ├── wallet.controller.ts     — GET /wallet, POST /wallet/deposit, GET /wallet/stats, GET /wallet/history
│   ├── wallet.module.ts
│   └── wallet.service.ts        — виртуальный кошелёк, P&L, история баланса
├── app.controller.ts            — GET /health
├── app.module.ts                — корневой модуль
├── app.service.ts
└── main.ts                      — ValidationPipe, CORS localhost:5173, порт 3000

## Все Endpoints
- GET  /health
- GET  /price/:coinId
- GET  /price/history/:coinId?limit=50
- POST /analyze
- GET  /analyze/decisions/:coinId?limit=50
- GET  /positions
- GET  /positions/:coinId
- GET  /positions/:coinId/open
- GET  /wallet
- POST /wallet/deposit              — { amount: number }
- GET  /wallet/stats?period=day|week|month|all
- GET  /wallet/history?period=day|week|month|all
- GET  /news                        — крипто-новости из RSS (Cointelegraph, Coindesk, Decrypt)
- GET  /news/digest                  — AI-дайджест ленты (кэш по хешу id, генерится в refresh)

## POST /analyze — формат запроса
{
"market": "BTC/USDT",
"coinId": "bitcoin",
"volume": 1500
}

## POST /analyze — формат ответа
{
"market": "BTC/USDT",
"currentPrice": 76565,
"previousPrice": 76568,
"movingAverage": 76594.2,
"ema9": 78440.42,
"ema21": 76744.19,
"rsi": 33.62,
"macd": { "macd": -228.37, "signal": -316.5, "histogram": 88.13 },
"bb": { "upper": 76661.86, "middle": 76588.8, "lower": 76515.74, "bandwidth": 0.19 },
"trend": "up" | "down" | "flat",
"decision": "BUY" | "SELL" | "SKIP",
"confidence": 60,
"riskScore": 5,
"expectedValue": 0.0001,
"reason": "EMA9 > EMA21 (×2) | MACD бычий (×2) | ...",
"aiReasoning": "текст от Groq на русском",
"timestamp": "2026-05-24T..."
}

## Логика решений (analyze.service.ts)

### Шумовой фильтр (динамический порог по монете)
- bitcoin:  |changePct| < 0.2% → SKIP
- ethereum: |changePct| < 0.25% → SKIP
- solana:   |changePct| < 0.4% → SKIP
- остальные: |changePct| < 0.3% → SKIP

### Weighted Confluence (6 индикаторов)
| Индикатор | Вес | BUY сигнал | SELL сигнал |
|-----------|-----|------------|-------------|
| EMA кросс | 2.0 | EMA9 > EMA21 | EMA9 < EMA21 |
| MACD | 2.0 | macd > signal && histogram > 0 | macd < signal && histogram < 0 |
| RSI | 1.5 | RSI < 35 (перепродан) | RSI > 65 (перекуплен) |
| Bollinger Bands | 1.5 | цена у нижней полосы | цена у верхней полосы |
| Тренд | 1.0 | trend == up | trend == down |
| MA5 | 1.0 | цена ниже MA5 > порога | цена выше MA5 > порога |

Порог: сумма весов ≥ 4.0 → BUY/SELL, иначе SKIP

### Контрарная коррекция
Если сигнал против тренда:
- confidence -= 15
- riskScore += 2
- Компенсация если RSI подтверждает разворот (+10)
- Компенсация если MACD histogram подтверждает (+8)

### Confidence формула

## Управление позициями (position.service.ts)

### Открытие позиции
- Открывается при BUY/SELL сигнале если нет открытой позиции по монете
- Stop loss = 2% от цены входа
- Одна позиция на монету одновременно

### Trailing Stop
- При новом максимуме (BUY) → стоп поднимается до currentPrice * 0.98
- При новом минимуме (SELL) → стоп опускается до currentPrice * 1.02
- Фиксирует часть прибыли при каждом новом хае/лоу

### Закрытие и Re-entry
- Стоп сработал → позиция закрывается → P&L записывается в WalletTransaction
- Следующий BUY/SELL сигнал → открывается новая позиция

## Модели БД
- PriceSnapshot — история цен (coinId, price, createdAt)
- TradeDecision — история решений (market, coinId, decision, confidence, ema9, ema21, rsi, ...)
- Wallet — виртуальный кошелёк (balance, initialBalance)
- WalletTransaction — история транзакций (amount, type: DEPOSIT|PROFIT|LOSS)
- Position — позиции (coinId, decision, entryPrice, stopLoss, highPrice, status, pnl, ...)

## Индикаторы (price.service.ts)
- getEMA(coinId, period) — экспоненциальное скользящее среднее
- getRSI(coinId, period=14) — индекс относительной силы
- getMACD(coinId) — MACD линия, сигнальная линия, histogram
- getBollingerBands(coinId, period=20) — upper/middle/lower/bandwidth
- getMovingAverage(coinId, points=5) — простое скользящее среднее MA5
- getTrend(coinId, points=10) — up/down/flat по соотношению ups/downs
- getPreviousPrice(coinId) — предыдущая цена из БД
- getHistory(coinId, limit) — история цен

## Переменные окружения (.env)
GROQ_API_KEY=...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trading_agent

## Инфраструктура
- Docker — postgres:16 контейнер
- npm run db:start  →  docker compose up -d
- npm run db:stop   →  docker compose down

## Запуск
npm run db:start
npm run start:dev

## Тесты
npm run test
9 тестов — все сценарии AnalyzeService включая weighted confluence

## AIDD Workflow

Процесс работы над новыми фичами через Claude Code.

### Структура
- `docs/<FEATURE>.md` — ТЗ фичи с tasklist в конце
- `docs/plan/<FEATURE>.md` — архитектурный план (генерируется `/plan`)
- `docs/tasklist/<FEATURE>.md` — детальный чек-лист (генерируется `/plan`)
- `.claude/commands/` — slash-команды (plan, implement, review)

### Команды
- `/plan <FEATURE>` — превратить ТЗ в архитектурный план и tasklist
- `/implement <FEATURE>` — реализовать следующую задачу из tasklist
- `/review <FEATURE>` — проверить реализацию

### Workflow для новой фичи
1. Создать `docs/<FEATURE>.md` с описанием и tasklist
2. `/plan <FEATURE>` → план + детальный tasklist
3. `/implement <FEATURE>` → итеративно по задачам
4. `/review <FEATURE>` → финальная проверка

### Текущие фичи
- `docs/BACKTEST.md` — модуль бэктестинга (в работе)

## Что сделано
- [x] NestJS проект с модульной структурой
- [x] CoinGecko интеграция — реальные цены
- [x] PostgreSQL + Prisma 7 — хранение всей истории
- [x] Cron — автоанализ каждые 5 минут (BTC/ETH/SOL)
- [x] 6 технических индикаторов (EMA, RSI, MACD, BB, MA5, тренд)
- [x] Weighted confluence — порог 4.0 из максимум 9.0
- [x] Динамический порог шума по монете
- [x] Контрарная коррекция confidence/riskScore
- [x] Trailing stop loss с re-entry
- [x] Виртуальный кошелёк — баланс, P&L, история
- [x] AI reasoning через Groq (llama-3.3-70b)
- [x] Logger — NestJS Logger везде
- [x] CORS — localhost:5173
- [x] 9 тестов для AnalyzeService

## Что впереди
- [ ] Telegram уведомления при сигналах
- [ ] Деплой на VPS (Hetzner/DigitalOcean)
- [ ] Реальный биржевой API (Bybit/MEXC)
- [ ] Claude Code интеграция
- [ ] Polymarket API — prediction markets как второй источник сигналов