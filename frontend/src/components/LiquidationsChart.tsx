import { useEffect, useRef, useState } from "react";
import styled, { useTheme } from "styled-components";
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  TickMarkType,
  createChart,
} from "lightweight-charts";
import type {
  HistogramData,
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import type { Exchange } from "../types/derivatives";
import type { LiqPeriod, Liquidations } from "../types/liquidations";
import { InfoHint } from "./InfoHint";
import { Skeleton } from "./Skeleton";

// data — ряд текущих монеты и периода; null — данных для них нет (запрос идёт
// или упал): график пуст, а не показывает прошлый выбор
interface Props {
  data: Liquidations | null;
  market: string;
  period: LiqPeriod;
  onPeriodChange: (p: LiqPeriod) => void;
  loading: boolean;
}

const HEIGHT = 240;
const SOURCE_URL = "https://coinalyze.net/";

// Текст PRD TASK-0015 (решение человека 2026-11-05)
export const INCOMPLETE_HINT =
  "Сумма может быть неполной. Настоящая сумма обычно больше: источник видит не все ликвидации";

const PERIODS: { label: string; value: LiqPeriod }[] = [
  { label: "1Д", value: "1d" },
  { label: "1М", value: "1m" },
  { label: "1Г", value: "1y" },
];

const EXCHANGES: { id: Exchange; label: string }[] = [
  { id: "binance", label: "Binance" },
  { id: "okx", label: "OKX" },
  { id: "bybit", label: "Bybit" },
];

type Bars = (HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[];

const toTime = (ms: number) => Math.round(ms / 1000) as UTCTimestamp;

// Сетка полная: нет записи — пустая точка, иначе ось по барам схлопнула бы
// промежуток. Шорты — вниз: столбики сторон не перекрывают друг друга
const toBars = (d: Liquidations) => {
  const long: Bars = [];
  const short: Bars = [];
  for (const p of d.points) {
    const time = toTime(p.t);
    if (p.longUsd === null || p.shortUsd === null) {
      long.push({ time });
      short.push({ time });
    } else {
      long.push({ time, value: p.longUsd });
      short.push({ time, value: -p.shortUsd });
    }
  }
  return { long, short };
};

const usd = (v: number) => {
  const abs = Math.abs(v);
  const fmt = (n: number, digits: number) =>
    n.toLocaleString("ru-RU", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  if (abs >= 1e9) return `$${fmt(abs / 1e9, 2)} млрд`;
  if (abs >= 1e6) return `$${fmt(abs / 1e6, 2)} млн`;
  if (abs >= 1e3) return `$${fmt(abs / 1e3, 1)} тыс.`;
  return `$${fmt(abs, 0)}`;
};

// Момент — местное время. По дням — только дата, границы суток в UTC
const formatMoment = (ms: number, period: LiqPeriod) => {
  const d = new Date(ms);
  if (period === "1y") {
    return d.toLocaleDateString("ru-RU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  }
  const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return `${date}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
};

// Дневные свечи режутся по 00:00 UTC: на 1Г подписи в UTC, иначе к западу от
// Гринвича дата съезжает на день (как режим рынка, TASK-0011)
const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

const tickMark = (period: LiqPeriod) => (time: Time, type: TickMarkType): string => {
  const d = new Date((time as UTCTimestamp) * 1000);
  const timeZone = period === "1y" ? "UTC" : undefined;
  switch (type) {
    case TickMarkType.Year:
      return d.toLocaleDateString("ru-RU", { timeZone, year: "numeric" });
    case TickMarkType.Month:
      return d.toLocaleDateString("ru-RU", { timeZone, month: "short" });
    case TickMarkType.DayOfMonth:
      return d.toLocaleDateString("ru-RU", { timeZone, day: "numeric", month: "short" });
    default:
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
};

const key = (d: Liquidations) => `${d.coinId}|${d.period}`;

export const LiquidationsChart = ({ data, market, period, onPeriodChange, loading }: Props) => {
  const theme = useTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ long: ISeriesApi<"Histogram">; short: ISeriesApi<"Histogram"> } | null>(null);
  // fitContent — только при смене монеты или периода: опрос не сбрасывает зум
  const drawnRef = useRef<string | null>(null);
  const [hover, setHover] = useState<{ key: string; t: number } | null>(null);

  // Создание — один раз; remove() обязателен (StrictMode монтирует дважды)
  useEffect(() => {
    const chart = createChart(boxRef.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.colors.surfaceCard },
        textColor: theme.colors.muted,
        fontFamily: theme.font.mono,
        fontSize: 11,
        attributionLogo: true, // условие лицензии lightweight-charts
      },
      grid: {
        vertLines: { color: theme.chart.grid },
        horzLines: { color: theme.chart.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.chart.crosshair, labelBackgroundColor: theme.colors.surfaceElevated },
        horzLine: { color: theme.chart.crosshair, labelBackgroundColor: theme.colors.surfaceElevated },
      },
      rightPriceScale: { borderColor: theme.colors.hairline },
      timeScale: { borderColor: theme.colors.hairline, fixLeftEdge: true, fixRightEdge: true },
    });
    // Шорты отрицательны только на графике: шкала показывает модуль
    const common = {
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "custom" as const, formatter: usd, minMove: 1 },
    };
    seriesRef.current = {
      long: chart.addSeries(HistogramSeries, { ...common, color: theme.chart.liqLong }),
      short: chart.addSeries(HistogramSeries, { ...common, color: theme.chart.liqShort }),
    };
    chartRef.current = chart;

    let alive = true;
    document.fonts.ready.then(() => {
      if (alive) chart.applyOptions({ layout: { fontFamily: theme.font.mono } });
    });

    return () => {
      alive = false;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      drawnRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        timeFormatter: (time: Time) => formatMoment((time as UTCTimestamp) * 1000, period),
      },
      timeScale: { timeVisible: period !== "1y", tickMarkFormatter: tickMark(period) },
    });
  }, [period, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s) return;
    // Без данных шкала спрятана: setData([]) не чистит её диапазон
    chart.applyOptions({ rightPriceScale: { visible: data != null } });
    if (!data) {
      s.long.setData([]);
      s.short.setData([]);
      drawnRef.current = null;
      return;
    }
    const { long, short } = toBars(data);
    s.long.setData(long);
    s.short.setData(short);
    if (key(data) !== drawnRef.current) chart.timeScale().fitContent();
    drawnRef.current = key(data);
  }, [data, theme]);

  // Перекрестие → момент точки; вне данных — null: легенда покажет последнюю
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const k = data ? key(data) : null;
    let last: number | null = null;
    const handler = (param: MouseEventParams<Time>) => {
      const sec = param.time as UTCTimestamp | undefined;
      const t = k && sec != null ? sec * 1000 : null;
      if (t === last) return;
      last = t;
      setHover(k && t != null ? { key: k, t } : null);
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [data, theme]);

  const points = data?.points ?? [];
  const hovered = hover && data && hover.key === key(data) ? points.find((p) => p.t === hover.t) : undefined;
  const shown = hovered ?? points[points.length - 1];
  const failed = new Set(data?.exchanges.filter((e) => "error" in e).map((e) => e.exchange));
  const missing = EXCHANGES.filter((e) => failed.has(e.id)).map((e) => e.label);

  return (
    <Container>
      <Controls>
        <Heading>
          <Title>Ликвидации</Title>
          <Market>{data?.market ?? market}</Market>
        </Heading>
        <Tabs>
          {PERIODS.map((p) => (
            <PeriodBtn key={p.value} $active={period === p.value} onClick={() => onPeriodChange(p.value)}>
              {p.label}
            </PeriodBtn>
          ))}
        </Tabs>
      </Controls>

      <Summary>
        <SummaryLabel>
          За 24 часа
          {data && ` до ${formatClock(data.last24h.to)}`}
        </SummaryLabel>
        {loading && <Skeleton $w="220px" $h="16px" />}
        {data && (
          <>
            <SummaryValue>лонги {usd(data.last24h.longUsd)}</SummaryValue>
            <SummaryValue>шорты {usd(data.last24h.shortUsd)}</SummaryValue>
          </>
        )}
        <InfoHint label="Что значит эта сумма">{INCOMPLETE_HINT}</InfoHint>
      </Summary>

      <Caption>
        USDT-контракты Binance + OKX + Bybit — не весь рынок
        {missing.length > 0 && <Missing> · нет записей {missing.join(", ")} — сумма может быть неполной</Missing>}
        {" · "}
        Данные:{" "}
        <SourceLink href={SOURCE_URL} target="_blank" rel="noopener">
          Coinalyze
        </SourceLink>
      </Caption>

      <Legend>
        {data && shown && (
          <>
            <Value>{formatMoment(shown.t, data.period)}</Value>
            {shown.longUsd === null || shown.shortUsd === null ? (
              <span>нет записей</span>
            ) : (
              <>
                <LegendItem>
                  <LegendSwatch $color={theme.chart.liqLong} />
                  лонги <Value>{usd(shown.longUsd)}</Value>
                </LegendItem>
                <LegendItem>
                  <LegendSwatch $color={theme.chart.liqShort} />
                  шорты <Value>{usd(shown.shortUsd)}</Value>
                </LegendItem>
              </>
            )}
          </>
        )}
      </Legend>

      <ChartArea aria-busy={loading}>
        <Box ref={boxRef} />
        {loading && (
          <ChartSkeleton>
            <Skeleton $h="100%" />
          </ChartSkeleton>
        )}
      </ChartArea>

      <Divider />
      {/* Оговорка — фиксированный текст, не AI (план TASK-0015) */}
      <Note>
        Ликвидация — биржа принудительно закрыла ставку. Лонги — ставки на рост (столбики вверх),
        шорты — на падение (столбики вниз). Пустое место — источник не записал ликвидаций ни на одной
        бирже: это может быть и затишье, и сбой. Если замолчит одна биржа, столбики просто станут ниже.
        Доллары примерные: источник пересчитывает их по цене свечи, а не самой ликвидации. Сумма за
        24 часа — по завершённым 15-минутным свечам, столбики графика могут кончаться раньше. Сравнивать
        суммы разных монет нельзя: полнота данных у них разная. Не прогноз и не указание к сделке.
      </Note>
    </Container>
  );
};

// --- styled ---

const Container = styled.div`
  background: ${({ theme }) => theme.colors.surfaceCard};
  border: 1px solid ${({ theme }) => theme.colors.hairline};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
`;

const Controls = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
`;

const Heading = styled.div`
  display: flex;
  align-items: baseline;
  gap: 12px;
`;

const Title = styled.div`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.muted};
`;

const Market = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.muted};
`;

const Tabs = styled.div`
  display: flex;
  gap: 2px;
`;

// category-tab внутри карточки — активная surfaceElevated (frontend/CLAUDE.md)
const PeriodBtn = styled.button<{ $active: boolean }>`
  padding: 3px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: none;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  background: ${({ $active, theme }) => ($active ? theme.colors.surfaceElevated : "transparent")};
  color: ${({ $active, theme }) => ($active ? theme.colors.ink : theme.colors.muted)};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
`;

const Summary = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-bottom: 6px;
`;

const SummaryLabel = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.muted};
`;

const SummaryValue = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.ink};
`;

const Caption = styled.div`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 8px;
`;

const Missing = styled.span`
  color: ${({ theme }) => theme.colors.warning};
`;

const SourceLink = styled.a`
  color: ${({ theme }) => theme.colors.body};
`;

// Точка под перекрестием, иначе последняя; min-height — строка не прыгает
const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  min-height: 16px;
  margin-bottom: 4px;
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

const LegendSwatch = styled.span<{ $color: string }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  background: ${({ $color }) => $color};
`;

const ChartArea = styled.div`
  position: relative;
`;

const Box = styled.div`
  height: ${HEIGHT}px;
`;

const ChartSkeleton = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
`;

const Divider = styled.div`
  border-top: 1px solid ${({ theme }) => theme.colors.hairline};
  margin: 12px 0 10px;
`;

const Note = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
`;
