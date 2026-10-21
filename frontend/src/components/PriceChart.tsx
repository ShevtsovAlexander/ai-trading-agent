import { useState } from "react";
import styled, { useTheme } from "styled-components";
import { INTERVAL_LABELS, RANGE_MS, isAllowed } from "../types/market";
import type { Interval, MarketSeries, Range } from "../types/market";
import { formatCandleTime } from "../utils/candleTime";
import { CandleChart } from "./CandleChart";
import { seriesKey } from "./chartData";
import type { HoverPoint } from "./CandleChart";

interface Coin {
  id: string;
  label: string;
  market: string;
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

// Легенда — значения свечи под перекрестием (иначе последней), как строка
// над графиком в TradingView. min-height — строка не прыгает без данных
const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  min-height: 16px;
  margin-bottom: 12px;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.muted};
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Value = styled.span`
  color: ${({ theme }) => theme.colors.body};
`;

const LegendDot = styled.span<{ $color: string; $dashed?: boolean }>`
  display: inline-block;
  width: 14px;
  border-top: 2px ${({ $dashed }) => ($dashed ? "dashed" : "solid")}
    ${({ $color }) => $color};
`;

// Два знака — та же точность, что у бэкенда и шкалы графика
const fmt = (v: number | null) =>
  v == null
    ? "—"
    : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

// --- component ---

export const PriceChart = ({
  data,
  coin,
  interval,
  range,
  onRangeChange,
  onIntervalChange,
}: Props) => {
  const theme = useTheme();
  const [hover, setHover] = useState<HoverPoint | null>(null);
  // Дата в подписи перекрестия — на окнах длиннее суток
  const withDate = RANGE_MS[range] > RANGE_MS["24h"];
  // Наведённая свеча ищется в текущих данных по ключу и времени: после смены
  // монеты её нет — легенда показывает последнюю; после опроса — та же
  // свеча из новых данных, перекрестие и числа не расходятся
  const n = data?.candles.length ?? 0;
  const hovered =
    hover && data && hover.key === seriesKey(data)
      ? data.candles.findIndex((c) => c.t === hover.t)
      : -1;
  const i = hovered >= 0 ? hovered : n - 1;
  const shown = data && i >= 0 ? { candle: data.candles[i], point: data.series[i] } : null;

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
        {shown && (
          <>
            <LegendItem>
              <Value>{formatCandleTime(shown.candle.t, interval, withDate)}</Value>
            </LegendItem>
            <LegendItem>
              O <Value>{fmt(shown.candle.open)}</Value>
              H <Value>{fmt(shown.candle.high)}</Value>
              L <Value>{fmt(shown.candle.low)}</Value>
              C <Value>{fmt(shown.candle.close)}</Value>
            </LegendItem>
            <LegendItem>
              <LegendDot $color={theme.chart.emaFast} />
              EMA9 <Value>{fmt(shown.point.ema9)}</Value>
            </LegendItem>
            <LegendItem>
              <LegendDot $color={theme.chart.emaSlow} />
              EMA21 <Value>{fmt(shown.point.ema21)}</Value>
            </LegendItem>
            <LegendItem>
              <LegendDot $color={theme.chart.bandLine} $dashed />
              BB <Value>{fmt(shown.point.bbLower)} – {fmt(shown.point.bbUpper)}</Value>
            </LegendItem>
          </>
        )}
      </Legend>

      <CandleChart
        data={data}
        interval={interval}
        withDate={withDate}
        onHover={setHover}
      />
    </Container>
  );
};
