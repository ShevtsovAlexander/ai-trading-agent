import styled from "styled-components";
import type { SeriesPoint } from "../types/market";

// series — ряды индикаторов текущего графика (свечи интервала)
interface Props {
  coinId: string;
  series: SeriesPoint[];
}

const ROWS = 50;

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

// Время открытия свечи, как в тултипе графика. Дата — если строки
// захватывают больше одних суток: иначе 23:55 и 00:00 не отличить.
const formatTime = (t: number, withDate: boolean): string =>
  new Date(t).toLocaleString("ru-RU", {
    ...(withDate && { day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  });

// --- component ---

export const IndicatorHistoryTable = ({ coinId, series }: Props) => {
  const rows = series.slice(-ROWS).reverse(); // новые сверху
  const withDate =
    rows.length > 0 &&
    new Date(rows[0].t).toDateString() !==
      new Date(rows[rows.length - 1].t).toDateString();

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

          {rows.length === 0 && <Empty>Нет данных</Empty>}

          {rows.map((d) => (
            <Row key={d.t}>
              <CoinCell>
                <Dot color={COIN_COLORS[coinId] ?? "#888"} />
                {COIN_LABELS[coinId] ?? coinId.toUpperCase()}
              </CoinCell>

              <Td>${d.close.toLocaleString()}</Td>

              <TdColored color={rsiColor(d.rsi)}>
                {d.rsi != null ? d.rsi.toFixed(1) : "—"}
              </TdColored>

              <Td>{formatTime(d.t, withDate)}</Td>
            </Row>
          ))}
        </Table>
      </Inner>
    </Container>
  );
};
