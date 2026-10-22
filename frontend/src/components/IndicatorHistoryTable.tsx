import styled, { useTheme, type DefaultTheme } from "styled-components";
import type { Interval, SeriesPoint } from "../types/market";
import { formatCandleTime } from "../utils/candleTime";

// series — ряды индикаторов текущего графика (свечи интервала)
interface Props {
  coinId: string;
  interval: Interval;
  series: SeriesPoint[];
}

const ROWS = 50;

const COIN_LABELS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
};

// --- styled ---

const Container = styled.div`
  background: ${({ theme }) => theme.colors.surfaceCard};
  border: 1px solid ${({ theme }) => theme.colors.hairline};
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

// caption-uppercase системы (DESIGN.md «Typography»)
const Title = styled.div`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.muted};
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
  border-bottom: 1px solid ${({ theme }) => theme.colors.hairline};
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
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
`;

// Числа и время — моноширинным: разряды в колонке стоят друг под другом
const Td = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.body};
`;

const TdColored = styled(Td)<{ $color?: string }>`
  color: ${({ $color, theme }) => $color ?? theme.colors.body};
`;

// Монета — монохромом, без цветной точки (план, вопрос 2)
const CoinCell = styled.div`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.ink};
`;

const Empty = styled.div`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.muted};
  text-align: center;
  padding: 24px 0;
`;

// --- helpers ---

const rsiColor = (rsi: number | null, theme: DefaultTheme): string | undefined => {
  if (rsi == null) return undefined;
  if (rsi < 35) return theme.colors.up;
  if (rsi > 65) return theme.colors.down;
  return undefined;
};


// --- component ---

export const IndicatorHistoryTable = ({ coinId, interval, series }: Props) => {
  const theme = useTheme();
  const rows = series.slice(-ROWS).reverse(); // новые сверху
  // Время открытия свечи, как в тултипе графика. Дата — если строки
  // захватывают больше одних суток: иначе 23:55 и 00:00 не отличить
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
                {COIN_LABELS[coinId] ?? coinId.toUpperCase()}
              </CoinCell>

              <Td>${d.close.toLocaleString()}</Td>

              <TdColored $color={rsiColor(d.rsi, theme)}>
                {d.rsi != null ? d.rsi.toFixed(1) : "—"}
              </TdColored>

              <Td>{formatCandleTime(d.t, interval, withDate)}</Td>
            </Row>
          ))}
        </Table>
      </Inner>
    </Container>
  );
};
