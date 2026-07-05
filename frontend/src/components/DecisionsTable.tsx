import styled from "styled-components";
import type { TradeDecision } from "../types/trading";

interface Props {
  decisions: TradeDecision[];
}

const DECISION_COLORS = {
  BUY: "#4ade80",
  SELL: "#f87171",
  SKIP: "#f59e0b",
};

const COIN_LABELS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
};

const COIN_COLORS: Record<string, string> = {
  bitcoin: "#F7931A",
  ethereum: "#627EEA",
  solana: "#9945FF",
};

// --- styled ---

const Container = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  position: relative;
`;

// Контент абсолютным слоем: не раздувает высоту строки грида, поэтому
// высоту диктует левая колонка, а список скроллится внутри → футеры на одном уровне.
const Inner = styled.div`
  position: absolute;
  inset: 0;
  padding: 16px;
  overflow: auto;
`;

const Title = styled.div`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
`;

const Table = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 560px;
`;

// 7 колонок: монета | цена | решение | уверенность | риск | RSI | время
const Row = styled.div`
  display: grid;
  grid-template-columns: 80px 100px 80px 90px 60px 60px 1fr;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.borderLight};
  align-items: center;

  &:last-child {
    border-bottom: none;
  }
`;

const HeadRow = styled(Row)`
  padding-bottom: 6px;
`;

const Th = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  text-transform: uppercase;
`;

const Td = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const TdColored = styled(Td)<{ color?: string }>`
  color: ${({ color, theme }) => color ?? theme.colors.textSecondary};
`;

const CoinCell = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text};
`;

const Dot = styled.span<{ color: string }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ color }) => color};
  display: inline-block;
  flex-shrink: 0;
`;

const Badge = styled.span<{ decision: "BUY" | "SELL" | "SKIP" }>`
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  background: ${({ decision }) => `${DECISION_COLORS[decision]}22`};
  color: ${({ decision }) => DECISION_COLORS[decision]};
`;

const Empty = styled.div`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.textMuted};
  text-align: center;
  padding: 24px 0;
`;

// --- helpers ---

const rsiColor = (rsi: number | null): string | undefined => {
  if (rsi == null) return undefined;
  if (rsi < 35) return "#4ade80";
  if (rsi > 65) return "#f87171";
  return undefined;
};

const riskColor = (risk: number): string => {
  if (risk <= 3) return "#4ade80";
  if (risk <= 6) return "#f59e0b";
  return "#f87171";
};

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

// --- component ---

export const DecisionsTable = ({ decisions }: Props) => {
  return (
    <Container>
      <Inner>
        <Title>История решений</Title>
        <Table>
        <HeadRow>
          <Th>Монета</Th>
          <Th>Цена</Th>
          <Th>Решение</Th>
          <Th>Уверен.</Th>
          <Th>Риск</Th>
          <Th>RSI</Th>
          <Th>Время</Th>
        </HeadRow>

        {decisions.length === 0 && <Empty>Нет данных</Empty>}

        {decisions.map((d) => (
          <Row key={d.id}>
            <CoinCell>
              <Dot color={COIN_COLORS[d.coinId] ?? "#888"} />
              {COIN_LABELS[d.coinId] ?? d.coinId.toUpperCase()}
            </CoinCell>

            <Td>${d.currentPrice.toLocaleString()}</Td>

            <Td>
              <Badge decision={d.decision}>{d.decision}</Badge>
            </Td>

            <TdColored color={d.confidence >= 70 ? "#4ade80" : undefined}>
              {d.confidence}%
            </TdColored>

            <TdColored color={riskColor(d.riskScore)}>
              {d.riskScore}/10
            </TdColored>

            <TdColored color={rsiColor(d.rsi)}>
              {d.rsi != null ? d.rsi.toFixed(1) : "—"}
            </TdColored>

            <Td>{formatTime(d.createdAt)}</Td>
          </Row>
        ))}
        </Table>
      </Inner>
    </Container>
  );
};
