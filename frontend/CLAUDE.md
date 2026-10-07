# AI Market Dashboard — Frontend

## Что это
React фронтенд информационного дашборда по крипторынку.
Показывает цену, индикаторы, AI-комментарий к состоянию рынка и ленту
новостей. **Не торговый терминал:** вердиктов BUY/SELL/SKIP, уверенности,
риска, позиций и кошелька на экране нет — сняты в TASK-0001. Рамка:
«триггеры, не команды». Границы — `../docs/VISION.md`.

## Стек
- React 18 + TypeScript
- Vite — сборщик
- styled-components — стили
- recharts — графики
- axios — HTTP запросы

## Структура проекта
src/
├── api/
│   ├── client.ts                 — общий axios-инстанс (baseURL localhost:3000)
│   ├── market.ts                 — refreshMarket, getHistory, getLatest (/market/*), getPriceHistory (/price/history)
│   └── news.ts                   — getNews, getDigest + типы NewsItem/Digest
├── components/
│   ├── MarketStateCard.tsx       — карточка состояния рынка: EMA/RSI/MACD/BB + секция «AI»
│   ├── IndicatorHistoryTable.tsx — история индикаторов, 4 колонки
│   ├── PriceChart.tsx            — график цены + EMA9/EMA21 + BB, переключатель диапазона
│   └── NewsPanel.tsx             — вкладка «Инфополе»: дайджест + лента
├── styles/
│   ├── GlobalStyles.ts           — глобальные стили
│   ├── styled.d.ts               — типизация темы для styled-components
│   └── theme.ts                  — токены (цвета, радиусы, размеры шрифтов)
├── types/
│   └── market.ts                 — PriceSnapshot, MarketSnapshot, MarketState, MarketRefreshDto
├── App.tsx                       — layout, табы, load(), опрос, handleRefresh
└── main.tsx                      — ThemeProvider, GlobalStyles

## Типы (types/market.ts)
- PriceSnapshot — точка истории цен
- MarketSnapshot — строка снимка рынка, индикаторы плоско, как в БД
- MarketState — MarketSnapshot + необязательный `aiComment`. Необязательный
  намеренно: `/market/snapshot` и `/market/refresh` его отдают, `/market/history`
  — нет, и строка истории подходит под тот же тип без союза форм
- MarketRefreshDto — { market, coinId }

## Ключевые решения
- Карточка кормится из `GET /market/snapshot/:coinId`, а не из первой строки
  истории: строка истории приходит без `aiComment`. Компилятор этого не
  стережёт — `aiComment` необязателен.
- `getLatest` нормализует пустое тело в `null`: для монеты без снимков бэкенд
  отвечает 200 с пустым телом, axios отдаёт `""`.
- `load()` — три запроса в одном `Promise.all` (цены, история, снимок).
  Подвисший Groq задерживает и график с таблицей — принято
  (`../docs/DECISIONS.md`, 2026-10-07).
- Токен запроса (`requestRef`) — поздний ответ после смены монеты, диапазона
  или следующего опроса в состояние не попадает.
- Два флага ошибок, не склеиваются: `dataError` — не удалось чтение, баннер
  «Нет связи с бэкендом» сверху; `actionError` — не сработала кнопка
  обновления, пометка у кнопки, данные при этом могут быть свежими.
- `matchSnapshots()` (PriceChart) — матчинг PriceSnapshot к ближайшему
  MarketSnapshot по времени (±5 мин): timestamps у двух таблиц разные.
- Первая загрузка в эффекте — через `Promise.resolve().then(load)`, не прямым
  вызовом (`react-hooks/set-state-in-effect`).

## Монеты
- bitcoin  → BTC/USDT → #F7931A
- ethereum → ETH/USDT → #627EEA
- solana   → SOL/USDT → #9945FF

## Опрос
- `load()` каждые 5 мин 10 с — сразу после cron бэкенда (раз в 5 минут)
- При смене монеты или диапазона графика — немедленная перезагрузка
- Кнопка «Обновить данные» — `POST /market/refresh`, затем `load()`
  независимо от исхода команды
- Каждый опрос вызывает LLM на бэкенде (кэш комментария при новой цене не
  срабатывает) — принято, `../docs/DECISIONS.md`, 2026-10-07

## Известное
- EMA9/EMA21/RSI/MACD с бэкенда сейчас мёртвые — считаются по самым старым
  данным (TASK-0002). Плоские линии EMA на графике — это данные, не баг рендера.
- `NewsPanel` — `try/finally` без `catch`: отказ `/news` даёт пустую ленту без
  индикации ошибки. Предсуществующий дефект, отдельный тикет.

## Дизайн
- Тёмная тема — фон #0d0d0d
- Акцент — #a78bfa (purple)
- Карточки — #1a1a1a, border #2a2a2a
- Все стили через styled-components + theme токены
- Без инлайн стилей

## Backend
- URL: http://localhost:3000
- CORS разрешён для localhost:5173

## Запуск
npm run dev

## Проверка
- `npx tsc -b` — 0 ошибок
- `npx eslint src` — exit 0 (код выхода снимать без пайпа)
- `npm run build`
- UI-тестов нет намеренно — false-green; приёмка UI глазами человека.

## Что впереди
- [ ] Loading скелетоны
- [ ] Адаптив под мобилку
