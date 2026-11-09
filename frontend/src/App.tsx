import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import styled from "styled-components";
import { getCandles, getView } from "./api/market";
import { classify, errorText } from "./api/errors";
import type { LoadError } from "./api/errors";
import { INTERVAL_MS, nearestAllowed } from "./types/market";
import type { Interval, MarketSeries, MarketView, Range } from "./types/market";
import {
  MarketStateCard,
  MarketStateCardSkeleton,
} from "./components/MarketStateCard";
import { PriceChart } from "./components/PriceChart";
import { IndicatorHistoryTable } from "./components/IndicatorHistoryTable";
import { NewsPanel } from "./components/NewsPanel";
import {
  DerivativesPanel,
  DerivativesPanelSkeleton,
} from "./components/DerivativesPanel";
import { OpenInterestChart } from "./components/OpenInterestChart";
import { LiquidationsChart } from "./components/LiquidationsChart";
import { useDerivatives } from "./hooks/useDerivatives";
import { useOpenInterestHistory } from "./hooks/useOpenInterestHistory";
import { useLiquidations } from "./hooks/useLiquidations";
import { useOrderBook } from "./hooks/useOrderBook";
import { useCoinFields } from "./hooks/useCoinFields";
import { useMarketRegime } from "./hooks/useMarketRegime";
import { useTreasury } from "./hooks/useTreasury";
import {
  TreasuryPanel,
  TreasuryPanelSkeleton,
} from "./components/TreasuryPanel";
import {
  MarketRegimePanel,
  MarketRegimePanelSkeleton,
} from "./components/MarketRegimePanel";
import {
  CoinFieldsPanel,
  CoinFieldsPanelSkeleton,
} from "./components/CoinFieldsPanel";
import type { OiPeriod, OiStep } from "./types/derivatives";
import type { LiqPeriod } from "./types/liquidations";
import { useDelayedFlag } from "./hooks/useDelayedFlag";
import { useChartHistory } from "./hooks/useChartHistory";
import { mergeSeries } from "./components/chartData";

// Монеты — монохром: цвет монеты был бы вторым брендовым цветом
// (план TASK-0003, вопрос 2)
const COINS = [
  { id: "bitcoin", label: "BTC", market: "BTC/USDT" },
  { id: "ethereum", label: "ETH", market: "ETH/USDT" },
  { id: "solana", label: "SOL", market: "SOL/USDT" },
];

type Tab = "market" | "intel";

export default function App() {
  const [range, setRange] = useState<Range>("24h");
  const [interval, setCandleInterval] = useState<Interval>("5m");
  const [activeCoin, setActiveCoin] = useState(COINS[0]);
  const [chart, setChart] = useState<MarketSeries | null>(null);
  const [view, setView] = useState<MarketView | null>(null);
  const [tab, setTab] = useState<Tab>("market");
  // Молчаливое console.warn не годится: отказ должен быть виден в интерфейсе.
  // Ошибки графика и карточки раздельно: /market/view падает и там, где
  // свечи есть (502 «Binance не отдал свечей», Groq) — график от этого
  // гаснуть не должен.
  const [chartError, setChartError] = useState<LoadError>(null);
  const [viewError, setViewError] = useState<LoadError>(null);

  // Токен запроса: ответ, приехавший после смены монеты, диапазона или
  // после следующего опроса, в состояние не попадает. Без него поздний
  // ответ прошлой монеты закрашивает экран новой, а флаг ошибки рапортует
  // «всё в порядке» на данных не той монеты.
  const requestRef = useRef(0);
  // Выбор, на который последний раз пришёл ответ (данные или ошибка).
  // Загрузка — пока текущий выбор с ним не совпал: ошибка прошлой монеты
  // не гасит скелетон новой (TASK-0005, критик)
  const [settled, setSettled] = useState("");

  const load = useCallback(async () => {
    const token = ++requestRef.current;
    const [c, v] = await Promise.allSettled([
      getCandles(activeCoin.id, interval, range),
      getView(activeCoin.id, interval),
    ]);
    if (token !== requestRef.current) return; // приехало поздно
    setSettled(`${activeCoin.id}|${interval}|${range}`);

    if (c.status === "fulfilled") {
      setChart(c.value);
      setChartError(null);
    } else {
      console.warn("[dashboard] свечи не загрузились:", c.reason);
      setChartError(classify(c.reason));
    }
    if (v.status === "fulfilled") {
      setView(v.value);
      setViewError(null);
    } else {
      console.warn("[dashboard] карточка не загрузилась:", v.reason);
      setViewError(classify(v.reason));
    }
  }, [activeCoin.id, interval, range]);

  // Интервал и диапазон — одним обработчиком: React сводит оба setState в
  // один рендер, и недопустимая промежуточная пара на бэкенд не уходит (400)
  const changeInterval = (next: Interval) => {
    setCandleInterval(next);
    setRange(nearestAllowed(range, next));
  };

  useEffect(() => {
    // Первая загрузка — из микротаски, а не прямым вызовом в теле эффекта:
    // setState внутри load() иначе попадает в тот же коммит и даёт каскадный
    // ререндер (react-hooks/set-state-in-effect). Семантика та же.
    Promise.resolve().then(load);
    // Опрос раз в min(интервал, 5 мин) + 10 с (план, trade-off 9). Таймер
    // не выровнен по закрытию свечи — отставание экрана от 0 до периода
    const poll = setInterval(
      load,
      Math.min(INTERVAL_MS[interval], 5 * 60 * 1000) + 10000,
    );
    return () => clearInterval(poll);
  }, [load, interval]);

  // Данные показываются, только если они про текущие монету, интервал и
  // диапазон: после переключения и отказа бэкенда под баннером иначе висели
  // бы чужие цены. Пока идёт запрос после переключения — блок пуст.
  const chartShown =
    chart &&
    chart.coinId === activeCoin.id &&
    chart.interval === interval &&
    chart.range === range
      ? chart
      : null;
  // История левее основного окна; на графике — их объединение по t.
  // Таблица остаётся на основном окне: ей нужны последние 50 точек
  const history = useChartHistory(activeCoin.id, interval, range, chartShown);
  const chartData = useMemo(
    () => (chartShown ? mergeSeries(history.chunks, chartShown) : null),
    [chartShown, history.chunks],
  );

  // Кусок левее самой ранней показанной свечи
  const { loadMore } = history;
  const needMore = useCallback(() => {
    if (chartData?.candles.length) loadMore(chartData.candles[0].t);
  }, [chartData, loadMore]);

  const viewShown =
    view && view.coinId === activeCoin.id && view.interval === interval
      ? view
      : null;
  // Загрузка — данных про текущий выбор нет, и ответа на него ещё не было:
  // первая загрузка и переключение. Опрос данные не прячет; ошибка текущего
  // выбора — баннер или пометка, без скелетона. Баннер прошлого выбора
  // висит до ответа, как в TASK-0004, — скелетон рядом с ним. Показ — через
  // 300 мс, ответ из кэша не мигает (TASK-0005)
  const pending = settled !== `${activeCoin.id}|${interval}|${range}`;
  const chartLoading = useDelayedFlag(!chartShown && pending, 300);
  const viewLoading = useDelayedFlag(!viewShown && pending, 300);
  // Деривативы — своя загрузка и опрос (TASK-0007, план trade-off 5)
  const derivatives = useDerivatives(activeCoin.id);
  // История OI — шаг «По дням» по умолчанию, почасовой ряд только по выбору
  // (TASK-0008, PRD 8)
  const [oiStep, setOiStep] = useState<OiStep>("1d");
  // Период графика позиций (TASK-0017); шаг выбирается только на 30 дней, на
  // годе и «Всё» — по дням, а выбор 30 дней запоминается
  const [oiPeriod, setOiPeriod] = useState<OiPeriod>("30d");
  const oiHistory = useOpenInterestHistory(
    activeCoin.id,
    oiPeriod,
    oiPeriod === "30d" ? oiStep : "1d",
  );
  // Ликвидации — своя загрузка и период, 1М по умолчанию (TASK-0015)
  const [liqPeriod, setLiqPeriod] = useState<LiqPeriod>("1m");
  const liquidations = useLiquidations(activeCoin.id, liqPeriod);
  // Стакан — своя загрузка, опрос 20 с (TASK-0009, план «Поток данных»)
  const orderBook = useOrderBook(activeCoin.id);
  // Поля монеты — своя загрузка, опрос 60 с (TASK-0010)
  const coinFields = useCoinFields(activeCoin.id);
  // Режим рынка — по монете, без интервала, опрос 5 мин (TASK-0011)
  const regime = useMarketRegime(activeCoin.id);
  // Компании-держатели — по монете, опрос 10 мин (TASK-0013)
  const treasury = useTreasury(activeCoin.id);

  return (
    <Wrapper>
      <Inner>
        <Header>
          <Title>
            AI <Accent>Market</Accent> Dashboard
          </Title>
          <HeaderTabs>
            <CoinTabs>
              {COINS.map((coin) => (
                <TabButton
                  key={coin.id}
                  $active={activeCoin.id === coin.id}
                  onClick={() => setActiveCoin(coin)}
                >
                  {coin.label}
                </TabButton>
              ))}
            </CoinTabs>
            <ViewTabs>
              <TabButton
                $active={tab === "market"}
                onClick={() => setTab("market")}
              >
                Рынок
              </TabButton>
              <TabButton
                $active={tab === "intel"}
                onClick={() => setTab("intel")}
              >
                Инфополе
              </TabButton>
            </ViewTabs>
          </HeaderTabs>
        </Header>

        <TabPanel $active={tab === "market"}>
          {chartError && (
            <ErrorBanner>
              ⚠ {errorText(chartError)}. Данные на экране могут быть
              устаревшими или отсутствовать.
            </ErrorBanner>
          )}

          <TopRow>
            {/* При упавшем графике причину уже назвал баннер; прошлый снимок
                той же монеты остаётся под пометкой */}
            {orderBook.error && !chartError && (
              <CardError>
                Стакан не обновился: {errorText(orderBook.error)}.
              </CardError>
            )}
            <PriceChart
              data={chartData}
              coin={activeCoin}
              interval={interval}
              range={range}
              onRangeChange={setRange}
              onIntervalChange={changeInterval}
              loading={chartLoading}
              onNeedMore={needMore}
              complete={history.complete}
              historyLoading={history.loading}
              historyError={history.error}
              capped={history.capped}
              orderBook={orderBook.data}
            />
          </TopRow>

          {/* Под графиком, полной ширины: в BottomRow высоту держит левая
              колонка (план TASK-0007, trade-off 6). Ошибка — пометкой, как
              у карточки; данные прошлого опроса остаются под ней */}
          <DerivativesRow>
            {derivatives.error && (
              <CardError>
                Деривативы не обновились: {errorText(derivatives.error)}.
              </CardError>
            )}
            {derivatives.data && <DerivativesPanel data={derivatives.data} />}
            {derivatives.loading && <DerivativesPanelSkeleton />}
            {/* История OI — своя карточка, не внутри панели: панель видна
                только при данных /derivatives (план TASK-0008, trade-off 6).
                Карточка смонтирована всегда — график не пересоздаётся; ошибка
                опроса — над ней, прошлый ряд остаётся */}
            {oiHistory.error && (
              <CardError>
                График позиций не обновился: {errorText(oiHistory.error)}.
              </CardError>
            )}
            <OpenInterestChart
              data={oiHistory.data}
              market={activeCoin.market}
              period={oiPeriod}
              onPeriodChange={setOiPeriod}
              step={oiStep}
              onStepChange={setOiStep}
              longAvailable={oiHistory.longAvailable}
              loading={oiHistory.loading}
            />
            {/* Ликвидации — своя карточка, как история OI (план TASK-0015) */}
            {liquidations.error && (
              <CardError>
                График ликвидаций не обновился: {errorText(liquidations.error)}.
              </CardError>
            )}
            <LiquidationsChart
              data={liquidations.data}
              market={activeCoin.market}
              period={liqPeriod}
              onPeriodChange={setLiqPeriod}
              loading={liquidations.loading}
            />
          </DerivativesRow>

          <BottomRow>
            <Left>
              {/* При упавшем графике причину уже назвал баннер */}
              {viewError && !chartError && (
                <CardError>
                  Карточка не обновилась: {errorText(viewError)}.
                </CardError>
              )}
              {viewShown && <MarketStateCard data={viewShown} />}
              {viewLoading && <MarketStateCardSkeleton />}
              {/* Режим рынка — под карточкой рынка, на месте снятого
                  «Тренда» (план TASK-0011, trade-off 4). Ошибка — пометкой,
                  прошлые данные той же монеты остаются под ней */}
              {regime.error && (
                <CardError>
                  Режим рынка не обновился: {errorText(regime.error)}.
                </CardError>
              )}
              {regime.data && <MarketRegimePanel data={regime.data} />}
              {regime.loading && <MarketRegimePanelSkeleton />}
              {/* Поля монеты — под карточкой рынка (план TASK-0010,
                  trade-off 5). Ошибка — пометкой, прошлые данные той же
                  монеты остаются под ней */}
              {coinFields.error && (
                <CardError>
                  Поля монеты не обновились: {errorText(coinFields.error)}.
                </CardError>
              )}
              {coinFields.data && <CoinFieldsPanel data={coinFields.data} />}
              {coinFields.loading && <CoinFieldsPanelSkeleton />}
              {/* Компании-держатели — под «Монетой» (план TASK-0013) */}
              {treasury.error && (
                <CardError>
                  Компании-держатели не обновились: {errorText(treasury.error)}.
                </CardError>
              )}
              {treasury.data && <TreasuryPanel data={treasury.data} />}
              {treasury.loading && <TreasuryPanelSkeleton />}
            </Left>
            <IndicatorHistoryTable
              coinId={activeCoin.id}
              interval={interval}
              series={chartShown?.series ?? []}
              loading={chartLoading}
            />
          </BottomRow>
        </TabPanel>

        <TabPanel $active={tab === "intel"}>
          <NewsPanel />
        </TabPanel>
      </Inner>
    </Wrapper>
  );
}

// --- styled ---

const Wrapper = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.canvas};
  padding: 24px;
`;

// Ширина контента — как у системы (~1280px, DESIGN.md «Grid & Container»)
const Inner = styled.div`
  max-width: 1280px;
  margin: 0 auto;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
`;

// Inter 700 с отрицательным трекингом — без него жирный Inter «широкий»
// (DESIGN.md «Typography → Principles»)
const Title = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  letter-spacing: -0.5px;
  color: ${({ theme }) => theme.colors.ink};
`;

// Жёлтый — место «а» из плана (вопрос 4)
const Accent = styled.span`
  color: ${({ theme }) => theme.colors.primary};
`;

const HeaderTabs = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
`;

const CoinTabs = styled.div`
  display: flex;
  gap: 8px;
`;

const ViewTabs = styled.div`
  display: flex;
  gap: 4px;
`;

// Вкладка — category-tab системы: неактивная прозрачная с приглушённым
// текстом, активная — поверхность карточки и белый текст. Не жёлтая:
// активных вкладок на экране несколько групп (план, вопрос 4)
const TabButton = styled.button<{ $active: boolean }>`
  padding: 8px 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  border: none;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.surfaceCard : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.ink : theme.colors.muted};
  font-weight: 500;
  font-size: ${({ theme }) => theme.fontSize.base};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
`;

const TabPanel = styled.div<{ $active: boolean }>`
  display: ${({ $active }) => ($active ? "block" : "none")};
`;

const ErrorBanner = styled.div`
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.colors.warning};
  background: ${({ theme }) => `${theme.colors.warning}1a`};
  color: ${({ theme }) => theme.colors.warning};
  font-size: ${({ theme }) => theme.fontSize.md};
`;

const CardError = styled.div`
  color: ${({ theme }) => theme.colors.warning};
  font-size: ${({ theme }) => theme.fontSize.md};
`;

// Кошелёк уехал из левой колонки в T6 — график занимает всю ширину
const TopRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
`;

const DerivativesRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
`;

// min-height: высоту строки задаёт левая колонка (таблица справа —
// абсолютным слоем), без карточки таблица схлопывалась до заголовка
const BottomRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  min-height: 360px;
`;

const Left = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
