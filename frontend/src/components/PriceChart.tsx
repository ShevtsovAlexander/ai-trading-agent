import styled from "styled-components";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PriceSnapshot, TradeDecision } from "../types/trading";
import { useState } from "react";

type ChartRange = "1h" | "4h" | "12h" | "24h" | "2w" | "1m" | "3m";

interface Coin {
  id: string;
  label: string;
  market: string;
  color: string;
}

interface Props {
  history: PriceSnapshot[];
  decisions: TradeDecision[];
  coin: Coin;
  onRangeChange: (limit: number) => void;
}

const RANGES: { label: string; value: ChartRange; limit: number }[] = [
  { label: "1ч", value: "1h", limit: 12 },
  { label: "4ч", value: "4h", limit: 48 },
  { label: "12ч", value: "12h", limit: 144 },
  { label: "24ч", value: "24h", limit: 288 },
  { label: "2нед", value: "2w", limit: 4032 },
  { label: "1мес", value: "1m", limit: 8640 },
  { label: "3мес", value: "3m", limit: 25920 },
];

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
  margin-bottom: 4px;
`;

const Legend = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
`;

const LegendDot = styled.span<{ color: string; dashed?: boolean }>`
  display: inline-block;
  width: 16px;
  height: 2px;
  background: ${({ color }) => color};
  opacity: ${({ dashed }) => (dashed ? 0.6 : 1)};
  border-radius: 1px;
`;

const TooltipContainer = styled.div`
  background: #1f1f1f;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
`;

const Controls = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
`;

const RangeTabs = styled.div`
  display: flex;
  gap: 4px;
`;

const RangeBtn = styled.button<{ active: boolean }>`
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

const DECISION_COLORS = {
  BUY: "#4ade80",
  SELL: "#f87171",
  SKIP: "#f59e0b",
};

/**
 * Матчим каждый PriceSnapshot к ближайшему TradeDecision по времени (±5 мин).
 * Прямой матч по createdAt ненадёжен — timestamps разные.
 */
const matchDecisions = (
  history: PriceSnapshot[],
  decisions: TradeDecision[]
): (PriceSnapshot & { decision: TradeDecision | null })[] => {
  if (!decisions.length) return history.map((h) => ({ ...h, decision: null }));

  return history.map((h) => {
    const hTime = new Date(h.createdAt).getTime();
    let closest: TradeDecision | null = null;
    let minDiff = 5 * 60 * 1000; // 5 минут — макс окно

    for (const d of decisions) {
      const diff = Math.abs(new Date(d.createdAt).getTime() - hTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = d;
      }
    }

    return { ...h, decision: closest };
  });
};

// --- tooltip ---

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <TooltipContainer>
      <div style={{ color: "#888", marginBottom: 4 }}>
        {new Date(d.createdAt).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
      <div style={{ color: "#fff", fontWeight: 500 }}>
        ${d.price.toLocaleString()}
      </div>
      {d.ema9 && (
        <div style={{ color: "#a78bfa" }}>EMA9: ${d.ema9.toLocaleString()}</div>
      )}
      {d.ema21 && (
        <div style={{ color: "#818cf8" }}>
          EMA21: ${d.ema21.toLocaleString()}
        </div>
      )}
      {d.bbUpper && (
        <div style={{ color: "#475569" }}>
          BB: ${d.bbLower.toLocaleString()} – ${d.bbUpper.toLocaleString()}
        </div>
      )}
      {d.decision && (
        <div
          style={{
            color:
              DECISION_COLORS[
                d.decision.decision as keyof typeof DECISION_COLORS
              ],
            marginTop: 4,
            fontWeight: 600,
          }}
        >
          {d.decision.decision} · {d.decision.confidence}%
        </div>
      )}
    </TooltipContainer>
  );
};

// --- custom dot для BUY/SELL/SKIP ---

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload.decision) return null;

  const dec = payload.decision.decision as keyof typeof DECISION_COLORS;
  if (dec === "SKIP") return null; // SKIP не рисуем — шум

  const color = DECISION_COLORS[dec];

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        stroke="#0d0d0d"
        strokeWidth={2}
      />
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        fontSize={9}
        fill={color}
        fontWeight={600}
      >
        {dec}
      </text>
    </g>
  );
};

const getTickFormatter = (range: ChartRange) => (v: string) => {
  const d = new Date(v);
  if (range === "2w" || range === "1m" || range === "3m") {
    return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

// --- component ---

export const PriceChart = ({
  history,
  decisions,
  coin,
  onRangeChange,
}: Props) => {
  const [activeRange, setActiveRange] = useState<ChartRange>("24h");

  const handleRange = (r: (typeof RANGES)[0]) => {
    setActiveRange(r.value);
    onRangeChange(r.limit);
  };

  const matched = matchDecisions(history, decisions);

  const data = matched.map((h) => ({
    ...h,
    ema9: h.decision?.ema9 ?? null,
    ema21: h.decision?.ema21 ?? null,
    bbUpper: h.decision?.bbUpper ?? null,
    bbLower: h.decision?.bbLower ?? null,
    bbRange: h.decision ? [h.decision.bbLower, h.decision.bbUpper] : null,
  }));

  const prices = history.map((h) => h.price);
  const min = Math.min(...prices) * 0.999;
  const max = Math.max(...prices) * 1.001;

  return (
    <Container>
      <Controls>
        <Title>{coin.market} — цена / EMA / BB</Title>
        <RangeTabs>
          {RANGES.map((r) => (
            <RangeBtn
              key={r.value}
              active={activeRange === r.value}
              onClick={() => handleRange(r)}
            >
              {r.label}
            </RangeBtn>
          ))}
        </RangeTabs>
      </Controls>

      <Legend>
        <LegendItem>
          <LegendDot color={coin.color} />
          Цена
        </LegendItem>
        <LegendItem>
          <LegendDot color="#a78bfa" dashed />
          EMA 9
        </LegendItem>
        <LegendItem>
          <LegendDot color="#818cf8" dashed />
          EMA 21
        </LegendItem>
        <LegendItem>
          <LegendDot color="#334155" />
          BB
        </LegendItem>
      </Legend>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data}>
          <XAxis
            dataKey="createdAt"
            tickFormatter={getTickFormatter(activeRange)}
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
            tickFormatter={(v) => `$${v.toLocaleString()}`}
            width={75}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="bbUpper"
            stroke="#334155"
            strokeWidth={1}
            fill="none"
            strokeDasharray="3 3"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="bbLower"
            stroke="#334155"
            strokeWidth={1}
            fill="#1e293b"
            fillOpacity={0.3}
            strokeDasharray="3 3"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ema9"
            stroke="#a78bfa"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="ema21"
            stroke="#818cf8"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={coin.color}
            strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ r: 4, fill: coin.color }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Container>
  );
};
