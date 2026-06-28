# AI Trading Agent — Dashboard

## Что это
React фронтенд для AI trading агента.
Визуализирует данные с бэкенда в реальном времени.

## Стек
- React 18 + TypeScript
- Vite — сборщик
- styled-components — стили
- recharts — графики
- axios — HTTP запросы

## Структура проекта
src/
├── api/
│   └── trading.ts          — все запросы к backend (axios), полная типизация
├── components/
│   ├── DecisionCard.tsx    — карточка решения: EMA/RSI/MACD/BB/прогресс-бары
│   ├── DecisionsTable.tsx  — таблица истории: 7 колонок включая RSI и риск
│   ├── PositionsPanel.tsx  — открытые/закрытые позиции с unrealized P&L
│   ├── PriceChart.tsx      — график цен + EMA9/EMA21 + BB + точки BUY/SELL
│   ├── StatsChart.tsx      — динамика баланса (AreaChart с градиентом)
│   └── WalletPanel.tsx     — кошелёк, P&L, прибыль/убыток, периоды
├── styles/
│   ├── GlobalStyles.ts     — глобальные стили
│   ├── styled.d.ts         — типизация темы для styled-components
│   └── theme.ts            — токены (цвета, радиусы, размеры шрифтов)
├── types/
│   └── trading.ts          — TypeScript интерфейсы (плоская структура TradeDecision)
├── App.tsx                 — layout, polling, fetchData, handleAnalyze
└── main.tsx                — ThemeProvider, GlobalStyles

## Типы (types/trading.ts)
- PriceSnapshot — история цен
- MACD, BollingerBands — вложенные объекты для AnalyzeResponse
- TradeDecision — плоская структура (macdValue/macdSignal/macdHistogram, bbUpper/bbLower/bbMiddle/bbBandwidth)
- AnalyzeResponse — вложенный macd/bb (live ответ от POST /analyze)
- Position — позиция с unrealized P&L из бэкенда
- Wallet, WalletStats — кошелёк и статистика

## Ключевые решения
- TradeDecision хранит индикаторы плоско (как в БД), AnalyzeResponse — вложенно
- isAnalyzeResponse() type guard — различает два типа в DecisionCard
- matchDecisions() — матчинг PriceSnapshot к TradeDecision по ближайшему времени (±5 мин)
- fetchData(updateLastDecision) — флаг чтобы не перезаписывать lastDecision после анализа
- cancelled флаг в useEffect — корректная очистка интервала
- initialBalance хранится отдельным стейтом, wallet проп убран из WalletPanel

## Монеты
- bitcoin  → BTC/USDT → #F7931A
- ethereum → ETH/USDT → #627EEA
- solana   → SOL/USDT → #9945FF

## Polling
- fetchData каждые 30 секунд
- При смене монеты или периода — немедленный рефетч
- После анализа — fetchData(false) чтобы сохранить свежий AnalyzeResponse

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

## Что сделано
- [x] WalletPanel — баланс, P&L, прибыль/убыток, переключатель периодов
- [x] PriceChart — цена + EMA9/EMA21 пунктир + BB зона + точки BUY/SELL
- [x] StatsChart — AreaChart с градиентом, ReferenceLine по initialBalance
- [x] DecisionCard — EMA/RSI/MACD/BB/EV прогресс-бары, type guard для двух типов
- [x] DecisionsTable — 7 колонок: монета/цена/решение/уверенность/риск/RSI/время
- [x] PositionsPanel — позиции с unrealized P&L (~), trailing high/low
- [x] Кнопка анализа — POST /analyze без перезаписи lastDecision
- [x] Переключатель монет — BTC/ETH/SOL
- [x] Polling каждые 30 секунд с корректным cleanup
- [x] Полная типизация всех API запросов

## Что впереди
- [ ] Loading скелетоны
- [ ] Адаптив под мобилку
- [ ] Уведомления при BUY/SELL сигнале
- [ ] Claude Code интеграция