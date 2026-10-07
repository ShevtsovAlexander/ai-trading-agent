# AI Market Dashboard — Backend

## Что это
NestJS backend информационного дашборда по крипторынку.
Собирает цены, считает технические индикаторы, пишет снимки рынка и даёт к
ним AI-комментарий; агрегирует новости и AI-дайджест ленты.

**Не торговый бот.** Решений BUY/SELL, позиций и кошелька нет — торговое ядро
снято в TASK-0001 (история — тег `v1-trading-bot`). Рамка: «триггеры, не
команды» — бэкенд описывает, что происходит, решение принимает человек.
Границы — корневые `../docs/VISION.md` и `../docs/ROADMAP.md`.

## Стек
- NestJS 11 (TypeScript)
- @nestjs/axios — HTTP запросы к внешним API
- @nestjs/config — переменные окружения
- @nestjs/schedule — cron задачи
- class-validator — валидация входящих данных
- groq-sdk — AI через Groq (модель из GROQ_MODEL, дефолт openai/gpt-oss-120b)
- Prisma 7 + @prisma/adapter-pg — ORM для PostgreSQL
- CoinGecko API — реальные цены криптовалют (бесплатно, без ключа)
- Binance API — исторические свечи для бэктеста

## Структура проекта
src/
├── ai/
│   ├── ai.module.ts
│   └── ai.service.ts             — Groq клиент, one-shot complete()
├── backtest/
│   ├── backtest.controller.ts    — POST /backtest/run
│   ├── backtest.dto.ts
│   ├── backtest.module.ts
│   ├── backtest.service.ts       — свечи Binance, симуляция стратегии на истории
│   ├── backtest.types.ts
│   └── backtest.indicators.spec.ts — индикаторы против technicalindicators
├── digest/
│   ├── digest.module.ts
│   ├── digest.service.ts         — AI-дайджест ленты, кэш по хешу набора id
│   └── digest.types.ts
├── market/
│   ├── market.controller.ts      — POST /market/refresh, GET /market/snapshot/:coinId, GET /market/history/:coinId
│   ├── market.dto.ts             — { market, coinId }
│   ├── market.module.ts
│   ├── market.service.ts         — captureSnapshot (индикаторы → MarketSnapshot), getLatest, getHistory
│   ├── market.comment.ts         — AI-комментарий к снимку, кэш по монете и хешу фактов
│   └── market.comment.spec.ts    — 6 тестов кэша и fallback'ов
├── news/
│   ├── news.controller.ts        — GET /news, GET /news/digest
│   ├── news.module.ts
│   ├── news.service.ts           — RSS-фиды (Cointelegraph, Coindesk, Decrypt), cron каждый час, дедуп, кэш
│   ├── news.translator.ts        — LLM-перевод заголовков с валидацией формы
│   └── news.types.ts             — NewsItem
├── price/
│   ├── price.controller.ts       — GET /price/:coinId, GET /price/history/:coinId
│   ├── price.module.ts
│   ├── price.scheduler.ts        — cron каждые 5 минут → снимок рынка по BTC/ETH/SOL
│   └── price.service.ts          — CoinGecko + EMA/RSI/MACD/BB/MA5/тренд
├── prisma/
│   ├── prisma.module.ts          — @Global(), экспортирует PrismaService
│   └── prisma.service.ts         — PrismaClient + @prisma/adapter-pg
├── app.controller.ts             — GET /health
├── app.module.ts                 — корневой модуль
├── app.service.ts
└── main.ts                       — ValidationPipe, CORS localhost:5173, порт 3000

## Все Endpoints
- GET  /health
- GET  /price/:coinId                     — текущая цена (побочно пишет строку PriceSnapshot, см. ниже)
- GET  /price/history/:coinId?limit=50
- POST /market/refresh                    — снять снимок рынка сейчас; ответ — снимок + aiComment
- GET  /market/snapshot/:coinId           — последний снимок + aiComment; нет снимков → 200 с пустым телом
- GET  /market/history/:coinId?limit=50   — история снимков, БЕЗ aiComment
- GET  /news                              — крипто-новости из RSS (Cointelegraph, Coindesk, Decrypt)
- GET  /news/digest                       — AI-дайджест ленты (кэш по хешу id, генерится в refresh)
- POST /backtest/run                      — прогон стратегии на исторических свечах

Ручные запросы — `test.http`.

## POST /market/refresh — формат запроса
{
"market": "BTC/USDT",
"coinId": "bitcoin"
}

## Снимок рынка — формат ответа (/market/refresh, /market/snapshot)
Плоский, как строка `MarketSnapshot` в БД, плюс `aiComment`:
{
"id": number,
"market": "BTC/USDT",
"coinId": "bitcoin",
"currentPrice": number,
"previousPrice": number | null,
"movingAverage": number | null,
"ema9": number | null,
"ema21": number | null,
"rsi": number | null,
"macdValue": number | null,
"macdSignal": number | null,
"macdHistogram": number | null,
"bbUpper": number | null,
"bbMiddle": number | null,
"bbLower": number | null,
"bbBandwidth": number | null,   — в процентах
"trend": "up" | "down" | "flat",
"createdAt": "2026-10-07T...",
"aiComment": string | null      — 2-3 предложения на русском
}

`/market/history` отдаёт массив таких же строк без `aiComment` — гонять
модель на 50 строк незачем.

## AI-комментарий (market.comment.ts)
- Описывает обстановку по показаниям индикаторов. Промпт запрещает
  рекомендации и действия («купить», «продать», «вход», «стоп», «стоит»).
- Генерится «на лету» в контроллере, в БД не хранится.
- Кэш — in-memory `Map` по `coinId`, ключ — хеш тех же фактов, что уходят в
  промпт (включая `currentPrice`). Цена меняется в каждом снимке, поэтому
  при опросе фронта кэш почти не срабатывает: ~1 вызов Groq на снимок.
  Принято осознанно — `../docs/DECISIONS.md`, запись 2026-10-07.
- Отказ модели не роняет маршрут: весь `describe()` под try, fallback на
  прошлый комментарий монеты, иначе `null`.

## Модели БД
- PriceSnapshot — история цен (coinId, price, createdAt)
- MarketSnapshot — снимок рынка: цена, previousPrice, MA5, EMA9/21, RSI,
  MACD (value/signal/histogram), BB (upper/middle/lower/bandwidth), тренд

## Индикаторы (price.service.ts)
- getEMA(coinId, period) — экспоненциальное скользящее среднее
- getRSI(coinId, period=14) — индекс относительной силы
- getMACD(coinId) — MACD линия, сигнальная линия, histogram
- getBollingerBands(coinId, period=20) — upper/middle/lower/bandwidth
- getMovingAverage(coinId, points=5) — простое скользящее среднее MA5
- getTrend(coinId, points=10) — up/down/flat по соотношению ups/downs
- getPreviousPrice(coinId) — предыдущая цена из БД
- getHistory(coinId, limit) — история цен

**Известный дефект — TASK-0002 (`../docs/aidd/prd/TASK-0002.prd.md`):**
`getEMA`, `getRSI`, `getMACD` берут `orderBy: 'asc'` с фиксированным `take` —
то есть самые старые строки истории, а не свежие. EMA9/EMA21/RSI/MACD
не меняются с мая, и AI-комментарий пересказывает эти мёртвые числа.
BB, MA5 и тренд берут `desc` и считаются верно.

**Долг:** `getPrice` пишет строку в `PriceSnapshot` на каждый вызов —
запись внутри геттера. Отдельный тикет.

## Переменные окружения (.env)
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b   # id модели Groq; дефолт в коде — openai/gpt-oss-120b
GROQ_REASONING_EFFORT=low        # low|medium|high; off — не слать параметр (модели без reasoning)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trading_agent

## Инфраструктура
- Docker — postgres:16 контейнер
- npm run db:start   →  docker compose up -d
- npm run db:stop    →  docker compose down
- npm run db:migrate →  prisma migrate dev

## Запуск
npm run db:start
npm run start:dev

`npm run start:prod` нерабочий: зовёт `node dist/main`, а сборка кладёт точку
входа в `dist/src/main.js`. Прод-запуск вручную — `node dist/src/main`.

## Тесты
npm run test
12 тестов, только с внешним оракулом:
- `market.comment.spec.ts` — 6: кэш комментария и fallback'и при отказе модели
- `backtest.indicators.spec.ts` — 6: EMA(9/21/26), RSI(14), MACD, BB(20) против
  библиотеки technicalindicators. Тест RSI зелёный при расхождении —
  false-green, отдельный тикет.

`npm run test:e2e` сломан до миграции (ждёт `GET /` → «Hello World!»).

## AIDD Workflow

Процесс живёт в корне репозитория, не здесь. Смотри `../CLAUDE.md` — раздел
«AIDD-флоу»: фазы `idea` → `research` → `plan` → `implement` (скиллы в
`.claude/skills/`), проверка — агент `critic`, артефакты — `docs/aidd/`,
активный тикет — `docs/aidd/.active_ticket`.

Прежние slash-команды `/plan`, `/implement`, `/review` в `backend/.claude/commands/`
удалены (коммит `d8777d9`) — их заменили корневые скиллы. Каталог `backend/docs/`
(`BACKTEST.md` + `plan/` + `tasklist/`) остался от того процесса: бэктест-модуль
реализован, артефакты держим как летопись, новые сюда не пишем.

Перед работой в бэкенде читай корневые `../docs/VISION.md` и `../docs/ROADMAP.md`.
