import styled from "styled-components";
import type { Position } from "../types/trading";

interface Props {
  positions: Position[];
}

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
  padding: 16px;
`;

const Title = styled.div`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
`;

const Empty = styled.div`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.textMuted};
  text-align: center;
  padding: 24px 0;
`;

const Table = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 520px;
  overflow-x: auto;
`;

// coinId | решение | вход | стоп | хай/лоу | P&L | статус
const Row = styled.div`
  display: grid;
  grid-template-columns: 70px 60px 100px 100px 100px 90px 70px;
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
  font-weight: 500;
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
  flex-shrink: 0;
`;

const DecisionBadge = styled.span<{ decision: "BUY" | "SELL" }>`
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  background: ${({ decision }) =>
    decision === "BUY" ? "#4ade8022" : "#f8717122"};
  color: ${({ decision }) => (decision === "BUY" ? "#4ade80" : "#f87171")};
`;

const StatusBadge = styled.span<{ status: "OPEN" | "CLOSED" }>`
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  background: ${({ status }) =>
    status === "OPEN" ? "#a78bfa22" : "#33333388"};
  color: ${({ status }) => (status === "OPEN" ? "#a78bfa" : "#666")};
`;

// --- helpers ---

const pnlColor = (pnl: number | null): string | undefined => {
  if (pnl == null) return undefined;
  if (pnl > 0) return "#4ade80";
  if (pnl < 0) return "#f87171";
  return undefined;
};

const fmt = (val: number) =>
  `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
// Для BUY позиции показываем highPrice (trailing вверх)
// Для SELL позиции показываем lowPrice (trailing вниз)
const trailingValue = (pos: Position): string => {
  if (pos.decision === "BUY") return fmt(pos.highPrice);
  return fmt(pos.lowPrice);
};

// --- component ---

export const PositionsPanel = ({ positions }: Props) => {
  if (positions.length === 0) {
    return (
      <Container>
        <Title>Позиции</Title>
        <Empty>Нет открытых позиций</Empty>
      </Container>
    );
  }

  return (
    <Container>
      <Title>Позиции ({positions.length})</Title>
      <Table>
        <HeadRow>
          <Th>Монета</Th>
          <Th>Тип</Th>
          <Th>Вход</Th>
          <Th>Стоп</Th>
          <Th>Хай/Лоу</Th>
          <Th>P&amp;L</Th>
          <Th>Статус</Th>
        </HeadRow>

        {positions.map((pos) => (
          <Row key={pos.id}>
            <CoinCell>
              <Dot color={COIN_COLORS[pos.coinId] ?? "#888"} />
              {COIN_LABELS[pos.coinId] ?? pos.coinId.toUpperCase()}
            </CoinCell>

            <Td>
              <DecisionBadge decision={pos.decision as "BUY" | "SELL"}>
                {pos.decision}
              </DecisionBadge>
            </Td>

            <Td>{fmt(pos.entryPrice)}</Td>

            <TdColored color="#f59e0b">{fmt(pos.stopLoss)}</TdColored>

            <Td>{trailingValue(pos)}</Td>

            <TdColored color={pnlColor(pos.pnl)}>
              {pos.pnl != null
                ? `${pos.pnl >= 0 ? "+" : ""}$${pos.pnl.toFixed(2)}${
                    pos.status === "OPEN" ? " ~" : ""
                  }`
                : "—"}
            </TdColored>

            <Td>
              <StatusBadge status={pos.status as "OPEN" | "CLOSED"}>
                {pos.status === "OPEN" ? "Открыта" : "Закрыта"}
              </StatusBadge>
            </Td>
          </Row>
        ))}
      </Table>
    </Container>
  );
};
