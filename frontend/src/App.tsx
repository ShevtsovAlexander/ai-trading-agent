import { useState, useEffect, useCallback, useRef } from "react";
import styled from "styled-components";
import {
  getPriceHistory,
  getHistory,
  getLatest,
  refreshMarket,
} from "./api/market";
import type { PriceSnapshot, MarketSnapshot, MarketState } from "./types/market";
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

export default function App() {
  const [chartLimit, setChartLimit] = useState(288);
  const [activeCoin, setActiveCoin] = useState(COINS[0]);
  const [history, setHistory] = useState<PriceSnapshot[]>([]);
  const [snapshots, setSnapshots] = useState<MarketSnapshot[]>([]);
  const [lastSnapshot, setLastSnapshot] = useState<MarketState | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("market");

  // Два разных отказа — два разных флага, и склеивать их нельзя.
  // dataError — чтение данных не удалось: на экране может быть не то, что
  // в бэкенде. actionError — не сработала команда обновления; данные при
  // этом могут быть свежими, и говорить «данные недоступны» было бы ложью.
  // Молчаливое console.warn не годится ни для того, ни для другого:
  // критерий 17 PRD требует, чтобы отказ был виден в интерфейсе.
  const [dataError, setDataError] = useState(false);
  const [actionError, setActionError] = useState(false);

  // Токен запроса: ответ, приехавший после смены монеты, диапазона или
  // после следующего опроса, в состояние не попадает. Без него поздний
  // ответ прошлой монеты закрашивает экран новой, а флаг ошибки рапортует
  // «всё в порядке» на данных не той монеты.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++requestRef.current;
    try {
      const [h, d, s] = await Promise.all([
        getPriceHistory(activeCoin.id, chartLimit),
        getHistory(activeCoin.id, chartLimit),
        getLatest(activeCoin.id),
      ]);
      if (token !== requestRef.current) return; // приехало поздно
      setHistory([...h].reverse());
      setSnapshots(d);
      // Карточка — из /market/snapshot, а не d[0] истории: строка истории
      // приходит без aiComment, и секция «AI» была бы пуста всегда.
      // null, а не «оставить прошлое»: у монеты без истории карточка иначе
      // показывала бы данные предыдущей монеты, без ошибки и без баннера.
      setLastSnapshot(s);
      setDataError(false);
    } catch (e) {
      if (token !== requestRef.current) return;
      console.warn("[dashboard] обновление данных не удалось:", e);
      setDataError(true);
    }
  }, [activeCoin.id, chartLimit]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshMarket({
        market: activeCoin.market,
        coinId: activeCoin.id,
      });
      setActionError(false);
    } catch (e) {
      console.warn("[dashboard] обновление по кнопке не удалось:", e);
      setActionError(true);
    } finally {
      setLoading(false);
    }

    // Перечитываем данные независимо от исхода команды, и флаг данных
    // ставит именно load(): упавший POST при живых GET не должен выдавать
    // «данные недоступны».
    await load();
  };

  useEffect(() => {
    // Первая загрузка — из микротаски, а не прямым вызовом в теле эффекта:
    // setState внутри load() иначе попадает в тот же коммит и даёт каскадный
    // ререндер (react-hooks/set-state-in-effect). Семантика та же.
    Promise.resolve().then(load);
    const interval = setInterval(load, 5 * 60 * 1000 + 10000);
    return () => clearInterval(interval);
  }, [load]);

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
          {dataError && (
            <ErrorBanner>
              ⚠ Нет связи с бэкендом. Данные на экране могут быть устаревшими
              или отсутствовать.
            </ErrorBanner>
          )}

          <TopRow>
            <PriceChart
              history={history}
              snapshots={snapshots}
              coin={activeCoin}
              onRangeChange={setChartLimit}
            />
          </TopRow>

          <BottomRow>
            <Left>
              {lastSnapshot && <MarketStateCard data={lastSnapshot} />}
              <RefreshBtn onClick={handleRefresh} disabled={loading}>
                {loading ? "Обновляю..." : "Обновить данные"}
              </RefreshBtn>
              {actionError && (
                <ActionError>
                  Не удалось обновить данные — бэкенд отказал. Данные ниже
                  могли не обновиться.
                </ActionError>
              )}
            </Left>
            <IndicatorHistoryTable snapshots={snapshots} />
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

const ActionError = styled.div`
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

const RefreshBtn = styled.button<{ disabled: boolean }>`
  width: 100%;
  padding: 12px;
  border-radius: ${({ theme }) => theme.radius.lg};
  border: none;
  background: ${({ disabled, theme }) =>
    disabled ? theme.colors.border : theme.colors.purple};
  color: #fff;
  font-weight: 600;
  font-size: ${({ theme }) => theme.fontSize.base};
  cursor: ${({ disabled }) => (disabled ? "not-allowed" : "pointer")};
  transition: opacity 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
`;
