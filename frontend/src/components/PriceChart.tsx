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
import type { PriceSnapshot, MarketSnapshot } from "../types/market";
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
  snapshots: MarketSnapshot[];
  coin: Coin;
  onRangeChange: (limit: number) => void;
}

const HOUR_MS = 60 * 60 * 1000;

// limit — сколько строк просить у бэкенда (шаг крона 5 мин), ms — окно
// по времени, которое показывает ось. Строки выбираются по количеству, и
// после паузы бэкенда в них попадают дни до неё — окно их отсекает.
const RANGES: { label: string; value: ChartRange; limit: number; ms: number }[] = [
  { label: "1ч", value: "1h", limit: 12, ms: HOUR_MS },
  { label: "4ч", value: "4h", limit: 48, ms: 4 * HOUR_MS },
  { label: "12ч", value: "12h", limit: 144, ms: 12 * HOUR_MS },
  { label: "24ч", value: "24h", limit: 288, ms: 24 * HOUR_MS },
  { label: "2нед", value: "2w", limit: 4032, ms: 14 * 24 * HOUR_MS },
  { label: "1мес", value: "1m", limit: 8640, ms: 30 * 24 * HOUR_MS },
  { label: "3мес", value: "3m", limit: 25920, ms: 90 * 24 * HOUR_MS },
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

/**
 * Матчим каждый PriceSnapshot к ближайшему MarketSnapshot по времени (±5 мин).
 * Прямой матч по createdAt ненадёжен — timestamps разные.
 */
const matchSnapshots = (
  history: PriceSnapshot[],
  snapshots: MarketSnapshot[]
): (PriceSnapshot & { snapshot: MarketSnapshot | null })[] => {
  if (!snapshots.length) return history.map((h) => ({ ...h, snapshot: null }));

  return history.map((h) => {
    const hTime = new Date(h.createdAt).getTime();
    let closest: MarketSnapshot | null = null;
    let minDiff = 5 * 60 * 1000; // 5 минут — макс окно

    for (const s of snapshots) {
      const diff = Math.abs(new Date(s.createdAt).getTime() - hTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = s;
      }
    }

    return { ...h, snapshot: closest };
  });
};

// --- tooltip ---

// Точка графика: снимок цены плюс подмешанные индикаторы из снимка рынка.
// Типизирована явно, чтобы тултип не ходил через any — recharts отдаёт
// элемент данных в payload[n].payload как есть.
// Пустая точка-разрыв (см. GAP_MS) — все поля, кроме t, null.
interface ChartPoint {
  t: number;
  price: number | null;
  ema9: number | null;
  ema21: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbRange: [number, number] | null;
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}

const CustomTooltip = ({
  active,
  payload,
  withDate,
}: TooltipProps & { withDate: boolean }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  // На точке-разрыве показывать нечего
  if (d.price == null) return null;

  return (
    <TooltipContainer>
      <div style={{ color: "#888", marginBottom: 4 }}>
        {new Date(d.t).toLocaleString("ru-RU", {
          ...(withDate && { day: "numeric", month: "short" }),
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
      {d.bbUpper != null && d.bbLower != null && (
        <div style={{ color: "#475569" }}>
          BB: ${d.bbLower.toLocaleString()} – ${d.bbUpper.toLocaleString()}
        </div>
      )}
    </TooltipContainer>
  );
};

const getTickFormatter = (withDate: boolean) => (v: number) => {
  const d = new Date(v);
  if (withDate) {
    return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

// Дыра между соседними точками длиннее 3 шагов крона — бэкенд не писал
// цены. Вставляем пустую точку, чтобы все серии рвались, а не тянули
// прямую через пропуск.
const GAP_MS = 15 * 60 * 1000;

// --- component ---

export const PriceChart = ({
  history,
  snapshots,
  coin,
  onRangeChange,
}: Props) => {
  const [activeRange, setActiveRange] = useState<ChartRange>("24h");

  const handleRange = (r: (typeof RANGES)[0]) => {
    setActiveRange(r.value);
    onRangeChange(r.limit);
  };

  const matched = matchSnapshots(history, snapshots);

  // Окно вкладки — от последней точки назад на её длину. Ось начинается с
  // первой точки в окне, а не с края окна: где истории ещё нет, рисовать
  // нечего, а пропуски внутри данных остаются видны разрывами
  const windowMs = RANGES.find((r) => r.value === activeRange)!.ms;
  const end = matched.length
    ? Date.parse(matched[matched.length - 1].createdAt)
    : 0;
  const start = end - windowMs;

  const allPoints: ChartPoint[] = matched.map((h) => ({
    t: Date.parse(h.createdAt),
    price: h.price,
    ema9: h.snapshot?.ema9 ?? null,
    ema21: h.snapshot?.ema21 ?? null,
    bbUpper: h.snapshot?.bbUpper ?? null,
    bbLower: h.snapshot?.bbLower ?? null,
    // Полоса BB для Area: [низ, верх]. Без одной из границ — null, а не
    // [null, null]: снимок без BB (истории < 20 точек) полосы не рисует
    bbRange:
      h.snapshot?.bbLower != null && h.snapshot?.bbUpper != null
        ? [h.snapshot.bbLower, h.snapshot.bbUpper]
        : null,
  }));
  const points = allPoints.filter((p) => p.t >= start);

  const data: ChartPoint[] = [];
  for (const p of points) {
    const prev = data[data.length - 1];
    if (prev && p.t - prev.t > GAP_MS) {
      data.push({
        t: (prev.t + p.t) / 2,
        price: null,
        ema9: null,
        ema21: null,
        bbUpper: null,
        bbLower: null,
        bbRange: null,
      });
    }
    data.push(p);
  }

  // Дата в подписях и тултипе — на окнах длиннее суток
  const withDate = windowMs > 24 * HOUR_MS;
  // Подписи оси — только на реальных точках: точка-разрыв посреди дыры
  // подписала бы дату, в которую данных нет
  const ticks = points.map((p) => p.t);

  // Домен Y — по цене и границам BB с отступом 0.1%. Обрезать серии recharts
  // и так не даст: при allowDataOverflow=false он расширяет заданный домен до
  // данных. Здесь — отступ от краёв и пустая история без Infinity. Цикл, а не
  // Math.min(...arr): на 3мес до ~78 тыс. значений — больше лимита
  // аргументов в Safari.
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    for (const v of [d.price, d.bbLower, d.bbUpper]) {
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const domain: [number | string, number | string] =
    min <= max ? [min * 0.999, max * 1.001] : ["auto", "auto"];

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
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={getTickFormatter(withDate)}
            tick={{ fill: "#555", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={domain}
            tick={{ fill: "#555", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${v.toLocaleString()}`}
            width={75}
          />
          <Tooltip
            content={<CustomTooltip withDate={withDate} />}
          />
          {/* Полоса BB: Area по [bbLower, bbUpper] заливает между границами
              и обводит обе (range area recharts) */}
          <Area
            type="monotone"
            dataKey="bbRange"
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
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={coin.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: coin.color }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Container>
  );
};
