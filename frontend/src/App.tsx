import { useState, useEffect, useCallback, useRef } from "react";
import styled from "styled-components";
import { isAxiosError } from "axios";
import { getCandles, getView } from "./api/market";
import { INTERVAL_MS, nearestAllowed } from "./types/market";
import type { Interval, MarketSeries, MarketView, Range } from "./types/market";
import { MarketStateCard } from "./components/MarketStateCard";
import { PriceChart } from "./components/PriceChart";
import { IndicatorHistoryTable } from "./components/IndicatorHistoryTable";
import { NewsPanel } from "./components/NewsPanel";

const COINS = [
  { id: "bitcoin", label: "BTC", market: "BTC/USDT", color: "#F7931A" },
  { id: "ethereum", label: "ETH", market: "ETH/USDT", color: "#627EEA" },
  { id: "solana", label: "SOL", market: "SOL/USDT", color: "#9945FF" },
];

type Tab = "market" | "intel";

// Отказ чтения — три разные причины, три разных текста: «network» — бэкенд
// не ответил; «binance» — бэкенд жив, но Binance не отдал данные (502);
// «http» — бэкенд ответил другой ошибкой (400/404/500).
type LoadError =
  | { kind: "network" }
  | { kind: "binance"; message: string }
  | { kind: "http"; status: number }
  | null;

const classify = (e: unknown): LoadError => {
  if (!isAxiosError(e) || !e.response) return { kind: "network" };
  const { status, data } = e.response;
  if (status === 502) {
    const message =
      typeof data?.message === "string" ? data.message : "Binance недоступен";
    return { kind: "binance", message };
  }
  return { kind: "http", status };
};

const errorText = (e: NonNullable<LoadError>): string =>
  e.kind === "network"
    ? "Нет связи с бэкендом"
    : e.kind === "binance"
      ? e.message
      : `Бэкенд вернул ошибку (код ${e.status})`;

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

  const load = useCallback(async () => {
    const token = ++requestRef.current;
    const [c, v] = await Promise.allSettled([
      getCandles(activeCoin.id, interval, range),
      getView(activeCoin.id, interval),
    ]);
    if (token !== requestRef.current) return; // приехало поздно

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
  const viewShown =
    view && view.coinId === activeCoin.id && view.interval === interval
      ? view
      : null;

  return (
    <Wrapper>
      <Inner>
        <Header>
          <Title>
            AI <Purple>Market</Purple> Dashboard
          </Title>
          <HeaderTabs>
            <CoinTabs>
              {COINS.map((coin) => (
                <CoinBtn
                  key={coin.id}
                  active={activeCoin.id === coin.id}
                  color={coin.color}
                  onClick={() => setActiveCoin(coin)}
                >
                  {coin.label}
                </CoinBtn>
              ))}
            </CoinTabs>
            <ViewTabs>
              <ViewTab
                $active={tab === "market"}
                onClick={() => setTab("market")}
              >
                Рынок
              </ViewTab>
              <ViewTab
                $active={tab === "intel"}
                onClick={() => setTab("intel")}
              >
                Инфополе
              </ViewTab>
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
            <PriceChart
              data={chartShown}
              coin={activeCoin}
              interval={interval}
              range={range}
              onRangeChange={setRange}
              onIntervalChange={changeInterval}
            />
          </TopRow>

          <BottomRow>
            <Left>
              {/* При упавшем графике причину уже назвал баннер */}
              {viewError && !chartError && (
                <CardError>
                  Карточка не обновилась: {errorText(viewError)}.
                </CardError>
              )}
              {viewShown && <MarketStateCard data={viewShown} />}
            </Left>
            <IndicatorHistoryTable
              coinId={activeCoin.id}
              interval={interval}
              series={chartShown?.series ?? []}
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
  background: ${({ theme }) => theme.colors.bg};
  padding: 24px;
`;

const Inner = styled.div`
  margin: 0 auto;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const Purple = styled.span`
  color: ${({ theme }) => theme.colors.purple};
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

const ViewTab = styled.button<{ $active: boolean }>`
  padding: 6px 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.purple : theme.colors.border};
  background: ${({ $active, theme }) =>
    $active ? `${theme.colors.purple}22` : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.purple : theme.colors.textSecondary};
  font-weight: 500;
  font-size: ${({ theme }) => theme.fontSize.md};
  cursor: pointer;
  transition: all 0.15s;
`;

const TabPanel = styled.div<{ $active: boolean }>`
  display: ${({ $active }) => ($active ? "block" : "none")};
`;

const CoinBtn = styled.button<{ active: boolean; color: string }>`
  padding: 6px 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ active, color }) => (active ? color : "#333")};
  background: ${({ active, color }) => (active ? `${color}22` : "transparent")};
  color: ${({ active, color, theme }) =>
    active ? color : theme.colors.textSecondary};
  font-weight: 500;
  font-size: ${({ theme }) => theme.fontSize.md};
  cursor: pointer;
  transition: all 0.15s;
`;

const ErrorBanner = styled.div`
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.colors.amber};
  background: ${({ theme }) => `${theme.colors.amber}1a`};
  color: ${({ theme }) => theme.colors.amber};
  font-size: ${({ theme }) => theme.fontSize.md};
`;

const CardError = styled.div`
  color: ${({ theme }) => theme.colors.amber};
  font-size: ${({ theme }) => theme.fontSize.md};
`;

// Кошелёк уехал из левой колонки в T6 — график занимает всю ширину
const TopRow = styled.div`
  margin-bottom: 16px;
`;

const BottomRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
`;

const Left = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
