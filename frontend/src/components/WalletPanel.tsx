import styled from "styled-components";
import type { WalletStats } from "../types/trading";

interface Props {
  stats: WalletStats | null;
}

const Container = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
`;

const Label = styled.div`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
`;

const Balance = styled.div`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const PnL = styled.div<{ positive: boolean }>`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ positive, theme }) =>
    positive ? theme.colors.green : theme.colors.red};
  margin-top: 4px;
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
`;

const StatCard = styled.div`
  background: ${({ theme }) => theme.colors.surfaceAlt};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 8px;
`;

const StatLabel = styled.div`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  margin-bottom: 2px;
`;

const StatValue = styled.div<{ color?: string }>`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 500;
  color: ${({ color, theme }) => color ?? theme.colors.text};
`;

export const WalletPanel = ({ stats }: Props) => {
  const positive = (stats?.pnl ?? 0) >= 0;

  return (
    <Container>
      <Label>Кошелёк</Label>
      <Balance>${stats?.balance.toLocaleString() ?? "—"}</Balance>
      <PnL positive={positive}>
        {positive ? "↑ +" : "↓ "}${stats?.pnl.toFixed(2) ?? "0"} (
        {stats?.pnlPct.toFixed(2) ?? "0"}%)
      </PnL>

      <StatGrid>
        <StatCard>
          <StatLabel>Прибыль</StatLabel>
          <StatValue color="#4ade80">
            +${stats?.profit.toFixed(2) ?? "0"}
          </StatValue>
        </StatCard>
        <StatCard>
          <StatLabel>Убыток</StatLabel>
          <StatValue color="#f87171">
            -${Math.abs(stats?.loss ?? 0).toFixed(2)}
          </StatValue>
        </StatCard>
        <StatCard>
          <StatLabel>Начало</StatLabel>
          <StatValue>${stats?.initialBalance ?? "100"}</StatValue>
        </StatCard>
        <StatCard>
          <StatLabel>Сделок</StatLabel>
          <StatValue>{stats?.transactions ?? "0"}</StatValue>
        </StatCard>
      </StatGrid>
    </Container>
  );
};
