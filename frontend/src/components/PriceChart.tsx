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
import { INTERVAL_LABELS, INTERVAL_MS, RANGE_MS, isAllowed } from "../types/market";
import type { Interval, MarketSeries, Range } from "../types/market";
import { formatCandleTime } from "../utils/candleTime";

interface Coin {
  id: string;
  label: string;
  market: string;
  color: string;
}

// data — свечи диапазона и ряды индикаторов от бэкенда; null — данных для
// текущей монеты и диапазона ещё (или уже) нет. Диапазон хранит App: по нему
// идёт запрос, и вкладка не должна расходиться с тем, что нарисовано.
interface Props {
  data: MarketSeries | null;
  coin: Coin;
  interval: Interval;
  range: Range;
  onRangeChange: (range: Range) => void;
  onIntervalChange: (interval: Interval) => void;
}

const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

const RANGES: { label: string; value: Range }[] = [
  { label: "1ч", value: "1h" },
  { label: "4ч", value: "4h" },
  { label: "12ч", value: "12h" },
  { label: "24ч", value: "24h" },
  { label: "2нед", value: "2w" },
  { label: "1мес", value: "1m" },
  { label: "3мес", value: "3m" },
  { label: "1г", value: "1y" },
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

// Интервалы и диапазоны — два ряда кнопок одного вида через разделитель
const Selectors = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

// Подписи рядов: «1ч» и «4ч» есть и среди свечей, и среди периодов
const SelectorLabel = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
`;

const Separator = styled.span`
  width: 1px;
  height: 14px;
  background: ${({ theme }) => theme.colors.border};
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

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;

// --- tooltip ---

// Точка графика: закрытая свеча (t — время открытия) плюс индикаторы на её
// закрытии. Типизирована явно, чтобы тултип не ходил через any — recharts
// отдаёт элемент данных в payload[n].payload как есть.
// Пустая точка-разрыв (см. gapMs) — все поля, кроме t, null.
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
  interval,
}: TooltipProps & { withDate: boolean; interval: Interval }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  // На точке-разрыве показывать нечего
  if (d.price == null) return null;

  return (
    <TooltipContainer>
      <div style={{ color: "#888", marginBottom: 4 }}>
        {formatCandleTime(d.t, interval, withDate)}
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

// Дыра между соседними свечами длиннее 3 интервалов — Binance не отдал
// свечи (остановка биржи). Вставляем пустую точку, чтобы все серии рвались,
// а не тянули прямую через пропуск.
const GAP_INTERVALS = 3;

// --- component ---

export const PriceChart = ({
  data: series,
  coin,
  interval,
  range,
  onRangeChange,
  onIntervalChange,
}: Props) => {
  // Бэкенд отдаёт ровно свечи диапазона, series[i].t === candles[i].t —
  // окно и сопоставление по времени не нужны
  const points: ChartPoint[] = (series?.candles ?? []).map((c, i) => {
    const s = series!.series[i];
    return {
      t: c.t,
      price: c.close,
      ema9: s.ema9,
      ema21: s.ema21,
      bbUpper: s.bbUpper,
      bbLower: s.bbLower,
      // Полоса BB для Area: [низ, верх]. Без одной из границ — null, а не
      // [null, null]: точка без BB полосы не рисует
      bbRange:
        s.bbLower != null && s.bbUpper != null ? [s.bbLower, s.bbUpper] : null,
    };
  });

  const gapMs = GAP_INTERVALS * INTERVAL_MS[interval];
  const data: ChartPoint[] = [];
  for (const p of points) {
    const prev = data[data.length - 1];
    if (prev && p.t - prev.t > gapMs) {
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
  const withDate = RANGE_MS[range] > RANGE_MS["24h"];
  // Подписи оси — только на реальных точках: точка-разрыв посреди дыры
  // подписала бы дату, в которую данных нет
  const ticks = points.map((p) => p.t);

  // Домен Y — по цене и границам BB с отступом 0.1%. Обрезать серии recharts
  // и так не даст: при allowDataOverflow=false он расширяет заданный домен до
  // данных. Здесь — отступ от краёв и пустая история без Infinity. Цикл, а не
  // Math.min(...arr): до 5000 свечей × 3 значения — у лимита аргументов
  // в Safari.
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
        <Selectors>
          <SelectorLabel>свеча</SelectorLabel>
          <RangeTabs>
            {INTERVALS.map((iv) => (
              <RangeBtn
                key={iv}
                active={interval === iv}
                onClick={() => onIntervalChange(iv)}
              >
                {INTERVAL_LABELS[iv]}
              </RangeBtn>
            ))}
          </RangeTabs>
          <Separator />
          <SelectorLabel>период</SelectorLabel>
        <RangeTabs>
          {RANGES.map((r) => (
            <RangeBtn
              key={r.value}
              active={range === r.value}
              // Больше MAX_CANDLES свечей на интервале — бэкенд ответит 400;
              // кнопка гаснет заранее (3мес на 5м — 25 920 свечей)
              disabled={!isAllowed(r.value, interval)}
              title={
                isAllowed(r.value, interval)
                  ? undefined
                  : "Слишком много свечей для этого интервала"
              }
              onClick={() => onRangeChange(r.value)}
            >
              {r.label}
            </RangeBtn>
          ))}
        </RangeTabs>
        </Selectors>
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
            content={<CustomTooltip withDate={withDate} interval={interval} />}
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
