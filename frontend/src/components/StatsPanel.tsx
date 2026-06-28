import { styled } from "styled-components";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type Period = "day" | "week" | "month" | "all";

interface DataPoint {
  date: string;
  balance: number;
}

interface Props {
  data: DataPoint[];
  initialBalance: number;
  period: Period;
  onPeriodChange: (p: Period) => void;
}

const PERIODS: { label: string; value: Period }[] = [
  { label: "День", value: "day" },
  { label: "Неделя", value: "week" },
  { label: "Месяц", value: "month" },
  { label: "Всё", value: "all" },
];

// --- styled ---

const Container = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
`;

const Controls = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const Title = styled.div`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const PeriodTabs = styled.div`
  display: flex;
  gap: 4px;
`;

const PeriodBtn = styled.button<{ active: boolean }>`
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.fontSize.xs};
  border: 1px solid
    ${({ active, theme }) =>
      active ? theme.colors.purple : theme.colors.border};
  background: ${({ active, theme }) =>
    active ? `${theme.colors.purple}22` : "transparent"};
  color: ${({ active, theme }) =>
    active ? theme.colors.purple : theme.colors.textMuted};
  cursor: pointer;
  transition: all 0.15s;
`;

const Empty = styled.div`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.textMuted};
  text-align: center;
  padding: 24px 0;
`;

const TooltipContainer = styled.div`
  background: #1f1f1f;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
`;

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as DataPoint;
  return (
    <TooltipContainer>
      <div style={{ color: "#888", marginBottom: 4 }}>{d.date}</div>
      <div style={{ color: "#fff", fontWeight: 500 }}>
        ${d.balance.toFixed(2)}
      </div>
    </TooltipContainer>
  );
};

export const StatsChart = ({
  data,
  initialBalance,
  period,
  onPeriodChange,
}: Props) => {
  const values = data.map((d) => d.balance);
  const min = Math.min(...values, initialBalance) * 0.999;
  const max = Math.max(...values, initialBalance) * 1.001;
  const isPositive = (data[data.length - 1]?.balance ?? 0) >= initialBalance;

  const color = isPositive ? "#4ade80" : "#f87171";
  const gradientId = `balance-gradient-${isPositive ? "pos" : "neg"}`;

  return (
    <Container>
      <Controls>
        <Title>Динамика баланса</Title>
        <PeriodTabs>
          {PERIODS.map((p) => (
            <PeriodBtn
              key={p.value}
              active={period === p.value}
              onClick={() => onPeriodChange(p.value)}
            >
              {p.label}
            </PeriodBtn>
          ))}
        </PeriodTabs>
      </Controls>

      {data.length === 0 ? (
        <Empty>Недостаточно данных</Empty>
      ) : (
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fill: "#555", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[min, max]}
              tick={{ fill: "#555", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={initialBalance}
              stroke="#333"
              strokeDasharray="4 4"
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: color }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Container>
  );
};
