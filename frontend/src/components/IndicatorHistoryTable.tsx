import styled from "styled-components";
import type { MarketSnapshot } from "../types/market";

interface Props {
  snapshots: MarketSnapshot[];
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
  min-width: 320px;
`;

// 4 колонки: монета | цена | RSI | время
const Row = styled.div`
  display: grid;
  grid-template-columns: 80px 100px 60px 1fr;
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

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

// --- component ---

export const IndicatorHistoryTable = ({ snapshots }: Props) => {
  return (
    <Container>
      <Inner>
        <Title>История индикаторов</Title>
        <Table>
          <HeadRow>
            <Th>Монета</Th>
            <Th>Цена</Th>
            <Th>RSI</Th>
            <Th>Время</Th>
          </HeadRow>

          {snapshots.length === 0 && <Empty>Нет данных</Empty>}

          {snapshots.map((d) => (
            <Row key={d.id}>
              <CoinCell>
                <Dot color={COIN_COLORS[d.coinId] ?? "#888"} />
                {COIN_LABELS[d.coinId] ?? d.coinId.toUpperCase()}
              </CoinCell>

              <Td>${d.currentPrice.toLocaleString()}</Td>

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
