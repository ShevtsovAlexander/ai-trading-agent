import { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import {
  getWallet,
  getWalletStats,
  getPriceHistory,
  getDecisions,
  analyzeMarket,
  getBalanceHistory,
} from "./api/trading";
import type {
  WalletStats,
  PriceSnapshot,
  TradeDecision,
  AnalyzeResponse,
} from "./types/trading";
import { DecisionCard } from "./components/DecisionCard";
import { WalletPanel } from "./components/WalletPanel";
import { PriceChart } from "./components/PriceChart";
import { DecisionsTable } from "./components/DecisionsTable";
import { StatsChart } from "./components/StatsPanel";
import { PositionsPanel } from "./components/PositionsPanel";
import { getPositions } from "./api/trading";
import type { Position } from "./types/trading";

const COINS = [
  { id: "bitcoin", label: "BTC", market: "BTC/USDT", color: "#F7931A" },
  { id: "ethereum", label: "ETH", market: "ETH/USDT", color: "#627EEA" },
  { id: "solana", label: "SOL", market: "SOL/USDT", color: "#9945FF" },
];

type Period = "day" | "week" | "month" | "all";

interface BalancePoint {
  date: string;
  balance: number;
}

export default function App() {
  const [balancePeriod, setPeriod] = useState<Period>("all");
  const [chartLimit, setChartLimit] = useState(288);
  const [activeCoin, setActiveCoin] = useState(COINS[0]);
  const [stats, setStats] = useState<WalletStats | null>(null);
  const [history, setHistory] = useState<PriceSnapshot[]>([]);
  const [decisions, setDecisions] = useState<TradeDecision[]>([]);
  const [lastDecision, setLastDecision] = useState<
    TradeDecision | AnalyzeResponse | null
  >(null);
  const [balanceHistory, setBalanceHistory] = useState<BalancePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);

  const fetchData = useCallback(async () => {
    const [w, s, h, d, bh, pos] = await Promise.all([
      getWallet(),
      getWalletStats("all"),
      getPriceHistory(activeCoin.id, chartLimit),
      getDecisions(activeCoin.id, chartLimit),
      getBalanceHistory(balancePeriod),
      getPositions(),
    ]);
    setStats(s);
    setHistory([...h].reverse());
    setDecisions(d);
    setBalanceHistory(bh);
    setPositions(pos);
    if (d.length > 0) setLastDecision(d[0]);
    return w;
  }, [activeCoin.id, balancePeriod, chartLimit]);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      await analyzeMarket({
        market: activeCoin.market,
        coinId: activeCoin.id,
        volume: 1500,
      });
      await fetchData();
    } finally {
      setLoading(false);
    }
  };

  // wallet только для initialBalance в StatsChart
  const [initialBalance, setInitialBalance] = useState(100);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const w = await fetchData();
      if (!cancelled) setInitialBalance(w.initialBalance);
    };

    run();
    const interval = setInterval(run, 5 * 60 * 1000 + 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchData]);

  return (
    <Wrapper>
      <Inner>
        <Header>
          <Title>
            AI <Purple>Trading</Purple> Agent
          </Title>
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
        </Header>

        <TopRow>
          <WalletPanel stats={stats} />
          <PriceChart
            history={history}
            decisions={decisions}
            coin={activeCoin}
            onRangeChange={setChartLimit}
          />
        </TopRow>

        <MidRow>
          <StatsChart
            data={balanceHistory}
            initialBalance={initialBalance}
            period={balancePeriod}
            onPeriodChange={setPeriod}
          />
        </MidRow>

        <BottomRow>
          <Left>
            {lastDecision && <DecisionCard data={lastDecision} />}
            <PositionsPanel positions={positions} />
            <AnalyzeBtn onClick={handleAnalyze} disabled={loading}>
              {loading ? "Анализирую..." : "⚡ Запустить анализ"}
            </AnalyzeBtn>
          </Left>
          <DecisionsTable decisions={decisions} />
        </BottomRow>
      </Inner>
    </Wrapper>
  );
}

// --- styled (без изменений) ---

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

const CoinTabs = styled.div`
  display: flex;
  gap: 8px;
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

const TopRow = styled.div`
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 16px;
  margin-bottom: 16px;
`;

const MidRow = styled.div`
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

const AnalyzeBtn = styled.button<{ disabled: boolean }>`
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
