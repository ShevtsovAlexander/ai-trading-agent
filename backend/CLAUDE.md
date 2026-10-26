# AI Market Dashboard — Backend

## Что это
NestJS backend информационного дашборда по крипторынку.
Берёт закрытые свечи Binance по запросу, считает по ним технические
индикаторы и даёт к последней свече AI-комментарий; агрегирует новости и
AI-дайджест ленты. Своей истории цен не копит — история у Binance
(TASK-0004, `../docs/DECISIONS.md` 2026-10-20).

**Не торговый бот.** Решений BUY/SELL, позиций и кошелька нет — торговое ядро
снято в TASK-0001 (история — тег `v1-trading-bot`). Рамка: «триггеры, не
команды» — бэкенд описывает, что происходит, решение принимает человек.
Границы — корневые `../docs/VISION.md` и `../docs/ROADMAP.md`.

## Стек
- NestJS 11 (TypeScript)
- @nestjs/axios — HTTP запросы к внешним API
- @nestjs/config — переменные окружения
- @nestjs/schedule — cron новостей (раз в час); цены по крону больше не собираются
- class-validator — валидация входящих данных
- groq-sdk — AI через Groq (модель из GROQ_MODEL, дефолт openai/gpt-oss-120b)
- Prisma 7 + @prisma/adapter-pg — ORM для PostgreSQL
- Binance API — закрытые свечи (`klines`) для дашборда и бэктеста; монеты —
  только пары Binance (BTC/ETH/SOL), CoinGecko-fallback снят в TASK-0004
- technicalindicators — только в тестах, эталон формул индикаторов

## Структура проекта
src/
├── ai/
│   ├── ai.module.ts
│   └── ai.service.ts             — Groq клиент, one-shot complete()
├── backtest/
│   ├── backtest.controller.ts    — POST /backtest/run
│   ├── backtest.dto.ts
│   ├── backtest.module.ts
│   ├── backtest.service.ts       — свечи Binance (свой fetchCandles), симуляция стратегии на истории
│   └── backtest.types.ts
├── binance/
│   ├── klines.ts                 — fetchClosedCandles: закрытые свечи постранично по 1000, незакрытая отброшена; вес из заголовка x-mbx-used-weight-1m
│   └── klines.spec.ts            — 5 тестов на честном фейке HTTP
├── digest/
│   ├── digest.module.ts
│   ├── digest.service.ts         — AI-дайджест ленты, кэш по хешу набора id
│   └── digest.types.ts
├── indicators/
│   ├── indicators.ts             — calcEMA/RSI/MACD/BB/SMA/Trend: чистые функции, общие для дашборда и бэктеста
│   └── indicators.spec.ts        — 11 тестов: формулы против technicalindicators
├── market/
│   ├── market.controller.ts      — GET /market/candles/:coinId, /market/candles/:coinId/history, /market/view/:coinId
│   ├── market.module.ts
│   ├── market.types.ts           — Interval/Range, границы, isAllowed, COINS, SeriesPoint, MarketView, HistoryChunk/HISTORY_CHUNK (зеркало — frontend/src/types/market.ts)
│   ├── market-data.service.ts    — свечи → ряды индикаторов, последняя свеча, кэш до закрытия следующей; куски истории, ограничитель запросов
│   ├── market-data.service.spec.ts — 21 тест: ряды против technicalindicators, кэш, 400/502; куски истории, стыки, ограничитель 429
│   ├── market.comment.ts         — AI-комментарий к MarketView, кэш по монете+интервалу
│   └── market.comment.spec.ts    — 9 тестов: кэш, fallback'и, строки промпта
├── news/
│   ├── news.controller.ts        — GET /news, GET /news/digest
│   ├── news.module.ts
│   ├── news.service.ts           — RSS-фиды (Cointelegraph, Coindesk, Decrypt), cron каждый час, дедуп, кэш
│   ├── news.translator.ts        — LLM-перевод заголовков с валидацией формы
│   └── news.types.ts             — NewsItem
├── prisma/
│   ├── prisma.module.ts          — @Global(), экспортирует PrismaService
│   └── prisma.service.ts         — PrismaClient + @prisma/adapter-pg
├── app.controller.ts             — GET /health
├── app.module.ts                 — корневой модуль
├── app.service.ts
└── main.ts                       — ValidationPipe, CORS localhost:5173, порт 3000

## Все Endpoints
- GET  /health
- GET  /market/candles/:coinId?interval=5m&range=24h — свечи диапазона + ряды индикаторов
- GET  /market/candles/:coinId/history?interval=5m&before=<мс> — кусок истории левее before (TASK-0006)
- GET  /market/view/:coinId?interval=5m              — последняя закрытая свеча интервала + aiComment
- GET  /news                              — крипто-новости из RSS (Cointelegraph, Coindesk, Decrypt)
- GET  /news/digest                       — AI-дайджест ленты (кэш по хешу id, генерится при обновлении ленты)
- POST /backtest/run                      — прогон стратегии на исторических свечах

Ручные запросы — `test.http`. Маршрутов `/price/*`, `/market/refresh`,
`/market/snapshot`, `/market/history` нет — сняты в TASK-0004 вместе с кроном.

## Интервалы, диапазоны, ошибки
- `coinId`: `bitcoin` | `ethereum` | `solana` (только пары Binance)
- `interval`: `1m` | `5m` | `15m` | `1h` | `4h` | `1d`
- `range`: `1h` | `4h` | `12h` | `24h` | `2w` | `1m` (30 дней) | `3m` (90) | `1y` (365)
- Комбинация допустима, если свечей в диапазоне от `MIN_CANDLES` (12) до
  `MAX_CANDLES` (5000): 24ч×5м = 288 ✓, 3мес×5м = 25 920 ✗, 4ч×1ч = 4 ✗.
- `400` — неизвестная монета/интервал/диапазон или недопустимая комбинация
  (сообщение называет причину).
- `502 { message: 'Binance недоступен' }` — запрос к Binance упал;
  `502 { message: 'Binance не отдал свечей' }` — `view` получил меньше 2
  свечей (сразу после остановки биржи).
- `/history`: `400` — `before` не число, не кратен интервалу или позже
  последней закрытой свечи (без запроса к Binance); `429 { message: 'Лимит
  Binance — история догрузится через минуту' }` — ограничитель запросов; `502` — как
  выше.

## Формы ответов
`/market/candles` → `{ coinId, market, interval, range, candles, series }`,
`series[i].t === candles[i].t`, разогрев отрезан:
- `Candle { t, open, high, low, close, volume }` — `t` = время открытия, мс
- `SeriesPoint { t, close, ema9, ema21, rsi, macd, macdSignal,
  macdHistogram, bbUpper, bbMiddle, bbLower, bbBandwidth }` — индикаторы на
  закрытии свечи; `null` — периоду не хватило свечей; округление до 2
  знаков (`close` — как у Binance); `bbBandwidth` — в процентах

`/market/candles/:coinId/history` → `HistoryChunk { coinId, market, interval,
before, candles, series, complete }`: свечи `t < before` (≤ `HISTORY_CHUNK` =
1500, по возрастанию), ряды той же формы; `complete: true` — левее у Binance
свечей нет (листинг пары).

`/market/view` → `MarketView { coinId, market, interval, closedAt, price,
previousPrice, ma5, trend, latest, recent, aiComment }`: `closedAt` —
closeTime последней закрытой свечи; `latest` — её `SeriesPoint`; `recent` —
5 последних, старые → новые; `trend` — по 10 последним close.

## Свечи и индикаторы (market-data.service.ts)
- Последняя закрытая свеча — по локальным часам с запасом `CLOSE_MARGIN_MS`
  (5 с): свеча, открытая на `floor((now − 5 с) / интервал) · интервал`, ещё
  идёт. Запас — потому что кэш держит результат целый интервал.
- Запрос к Binance — диапазон + `WARMUP` (500) свечей слева; индикаторы
  считаются по всем close, разогрев отрезается по `t`. 500, а не 200: остаток
  затравки = вес × её ошибка, на 1д при 200 карточка расходилась с графиком
  на 0.01 (`../docs/DECISIONS.md` 2026-10-20).
- Формулы — `indicators/indicators.ts` (одни с бэктестом); MA5 — `calcSMA`,
  тренд — `calcTrend` (ups > downs × 1.5, перенос бывшего `getTrend`).
- `getView` берёт свои 10 свечей + разогрев, а не диапазон графика:
  карточка не зависит от вкладки; при `WARMUP` 500 `latest` совпадает с
  последней точкой графика на любом диапазоне.
- Кэш — до закрытия следующей свечи: ключ `монета|интервал|число свечей|
  openTime последней закрытой`, 50 записей, вытеснение FIFO. Если Binance
  ещё не отдал только что закрытую свечу — результат не кэшируется.
- Дыры самой Binance (остановки биржи) отдаются как есть — шаг `t` больше
  интервала, фронт рвёт линии.

## История и ограничитель запросов к Binance (TASK-0006)
- `getHistory(coin, interval, before)` — окно `HISTORY_CHUNK + WARMUP`
  (1500 + 500) свечей до `before`, ряды тем же `toSeries`, разогрев
  отрезан: значения куска = длинный ряд, включая его первую свечу (jest
  против `technicalindicators`; живая сверка 85 668 значений, TASK-0006.9).
  Стык: последняя свеча куска = `before − шаг`, дублей нет.
- `complete` — в окне с разогревом нет свечей раньше начала куска (листинг
  внутри окна или пусто): BTC 1д — 2017-08-17, SOL — 2020-08-11.
- Кэш кусков — по `монета|интервал|before`, 50 записей, FIFO; кусок без
  правой свечи (сбой, листинг, остановка биржи) не кэшируется.
- **Ограничитель запросов** — тормоз, чтобы Binance не забанил IP (вес —
  его счётчик нагрузки, лимит 6000 в минуту). `fetchClosedCandles` отдаёт
  вес из заголовка `x-mbx-used-weight-1m` последнего ответа; сервис помнит
  его с минутой. Вес ≥ `WEIGHT_THROTTLE` (4800 = 80 % лимита) в текущей
  минуте UTC — `getHistory` отвечает 429 без запроса к Binance;
  кэшированный кусок отдаётся и при нём. Отказ Binance 429/418 включает
  ограничитель до конца минуты. Основное окно и карточку ограничитель не
  режет (на отказ Binance — 502, как раньше). Нет заголовка — ограничитель
  выключен, `logger.warn` один раз.

## AI-комментарий (market.comment.ts)
- `describeView(view)` описывает обстановку на последней закрытой свече
  интервала. Промпт запрещает рекомендации и действия («купить», «продать»,
  «вход», «стоп», «стоит»).
- В промпте — интервал, тренд за 10 свечей и 5 последних свечей по строке
  на индикатор, слева направо от старой к последней, с **изменением за окно,
  посчитанным кодом** («рост на 130.11»), плюс строка «EMA9 относительно
  EMA21» по свечам. Сравнивая числа сама, модель путала порядок и знак
  (критик T5). Системный промпт: динамику — только по приведённым данным.
- Генерится «на лету» в контроллере, в БД не хранится.
- Кэш — in-memory `Map` по `coinId|interval`, ключ — хеш тех же фактов, что
  уходят в промпт. Факты меняются на каждом закрытии свечи → на 1м Groq
  зовётся раз в минуту на монету (план TASK-0004, trade-off 6).
- Отказ модели не роняет маршрут: весь `generate()` под try, fallback на
  прошлый комментарий ключа, иначе `null`.

## Модели БД
- `PriceSnapshot`, `MarketSnapshot` — **архив**: с TASK-0004 в них никто не
  пишет и никто не читает. Схема и данные оставлены, миграции нет
  (план TASK-0004, trade-off 4); удаление — отдельным шагом, если понадобится.

## Известное
- Binance — единственный источник цен: недоступен → `502`, фронт показывает
  баннер. `api.binance.com` недоступен из ряда юрисдикций.
- `/market/view` ждёт Groq синхронно, таймаута у клиента нет: промах кэша
  добавляет 1–1.7 с к ответу с ценой (tasklist TASK-0004, «Замечено рядом»).
- Сразу после остановки биржи `view` может ответить 502 «Binance не отдал
  свечей» при доступной бирже (дыра в последних 10 слотах).
- AI читает посчитанные изменения верно не всегда: на 1д рост отрицательной
  MACD-гистограммы назван «усилением нисходящего давления». Оракула у
  текста нет — проверка живой сверкой.
- `backtest.service.ts` держит свой `fetchCandles` — дубль `binance/klines.ts`.
- Простой Binance длиннее окна куска с разогревом (2000 свечей: ≈ 7 дней
  на 5м, ≈ 21 день на 15м) даст `complete: true` и метку «начало истории»
  с датой после простоя. У BTC/ETH/SOL таких простоев не замечено, по
  данным не проверялось (критик TASK-0006.8).

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
46 тестов, только с внешним оракулом:
- `indicators/indicators.spec.ts` — 11: EMA(9/21/26), RSI(14) на ряде и трёх
  краевых, MACD, BB(20), ширина BB, SMA(5) против technicalindicators.
- `binance/klines.spec.ts` — 5: пагинация 2300 свечей за 3 запроса,
  отсечение незакрытой свечи, защита от «страница не сдвинулась», вес из
  заголовка последнего ответа и `null` без заголовка; фейк HTTP честно
  применяет `startTime`/`endTime`/`limit`.
- `market/market-data.service.spec.ts` — 21: все поля рядов по всем точкам
  против technicalindicators на тех же close, разогрев не утёк, кэш до
  закрытия свечи (счётчик запросов), запас на часы, 1д с крупными ценами
  (`latest` = последняя точка графика), 400/502; куски истории — ряды =
  длинный ряд с первой свечи куска, стыки без дыр и дублей, листинг →
  `complete`, 400 на `before`, кэш, ограничитель 429 (по весу и по отказу
  Binance), предупреждение без заголовка.
- `market/market.comment.spec.ts` — 9: кэш и fallback'и при отказе модели,
  точные строки промпта (изменения — арифметика), разные интервалы — разные
  записи кэша.

Каждый новый тест прогнан против мутанта кода (красный) — итоги в
`../docs/aidd/tasklist/TASK-0004.md`.

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
