import { useEffect, useRef, useState } from "react";
import styled, { useTheme } from "styled-components";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  TickMarkType,
  createChart,
} from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import type { Exchange, OiStep, OpenInterestHistory } from "../types/derivatives";
import { Skeleton } from "./Skeleton";

// data — ряд текущих монеты и шага; null — данных для них нет (запрос идёт
// или упал): график пуст, а не показывает прошлую монету
interface Props {
  data: OpenInterestHistory | null;
  market: string; // 'BTC/USDT' — в заголовке и без данных
  step: OiStep;
  onStepChange: (s: OiStep) => void;
  loading: boolean;
}

const HEIGHT = 260;

const STEP_MS: Record<OiStep, number> = { "1d": 86_400_000, "1h": 3_600_000 };

const STEPS: { label: string; value: OiStep }[] = [
  { label: "По дням", value: "1d" },
  { label: "По часам", value: "1h" },
];

const EXCHANGES: { id: Exchange; label: string }[] = [
  { id: "binance", label: "Binance" },
  { id: "okx", label: "OKX" },
  { id: "bybit", label: "Bybit" },
];

// Как в chartData.ts: LineSeries соединяет соседей через пустую точку,
// отрезок красится цветом левой точки — прозрачная точка перед разрывом
// прячет «мост»
const BRIDGE = "transparent";

type Line = (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[];

const toTime = (ms: number) => Math.round(ms / 1000) as UTCTimestamp;

const pushLine = (out: Line, time: UTCTimestamp, value: number | null) => {
  if (value == null) {
    const last = out[out.length - 1];
    if (last && "value" in last) out[out.length - 1] = { ...last, color: BRIDGE };
    out.push({ time });
  } else {
    out.push({ time, value });
  }
};

// Дыра — соседние моменты дальше шага: в пропущенный момент не было всех
// учтённых бирж (план TASK-0008, решение 4). Ось — по барам: без пустой
// точки пропуск схлопнулся бы бесследно
const toLines = (d: OpenInterestHistory) => {
  const oi: Line = [];
  const price: Line = [];
  d.points.forEach((p, i) => {
    const prev = d.points[i - 1];
    if (prev && p.t - prev.t > STEP_MS[d.step]) {
      const gap = toTime((prev.t + p.t) / 2);
      pushLine(oi, gap, null);
      pushLine(price, gap, null);
    }
    const time = toTime(p.t);
    pushLine(oi, time, p.totalUsd);
    pushLine(price, time, p.price);
  });
  return { oi, price };
};

// Момент точки — местное время. По дням — только дата: снимок 00:00 UTC
// (решение человека, T6)
const formatMoment = (ms: number, step: OiStep) => {
  const d = new Date(ms);
  const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  if (step === "1d") return date;
  return `${date}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
};

const tickMark = (time: Time, type: TickMarkType): string => {
  const d = new Date((time as UTCTimestamp) * 1000);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return d.toLocaleDateString("ru-RU", { month: "short" });
    case TickMarkType.DayOfMonth:
      return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    default:
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
};

const bn = (usd: number) =>
  `${(usd / 1e9).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} млрд`;

const fmtPrice = (v: number) =>
  v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const key = (d: OpenInterestHistory) => `${d.coinId}|${d.step}`;

export const OpenInterestChart = ({ data, market, step, onStepChange, loading }: Props) => {
  const theme = useTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ oi: ISeriesApi<"Line">; price: ISeriesApi<"Line"> } | null>(null);
  // fitContent — только при смене монеты или шага: опрос не сбрасывает зум
  const drawnRef = useRef<string | null>(null);
  // Момент под перекрестием и ключ ряда, к которому он относится
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
      // Две шкалы: OI — млрд USD, цена — тысячи; на общей цена сплющилась бы
      // (план TASK-0008, trade-off 7)
      rightPriceScale: { borderColor: theme.colors.hairline },
      leftPriceScale: { borderColor: theme.colors.hairline },
      timeScale: { borderColor: theme.colors.hairline, fixLeftEdge: true, fixRightEdge: true },
    });
    const common = { priceLineVisible: false, lastValueVisible: false };
    seriesRef.current = {
      oi: chart.addSeries(LineSeries, {
        ...common,
        color: theme.chart.oi,
        lineWidth: 2,
        priceScaleId: "right",
        priceFormat: { type: "custom", formatter: bn, minMove: 1e6 },
      }),
      price: chart.addSeries(LineSeries, {
        ...common,
        color: theme.chart.oiPrice,
        lineWidth: 1,
        priceScaleId: "left",
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      }),
    };
    chartRef.current = chart;

    // Подписи осей — веб-шрифтом после его загрузки (как CandleChart)
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
        timeFormatter: (time: Time) => formatMoment((time as UTCTimestamp) * 1000, step),
      },
      timeScale: { timeVisible: step === "1h", tickMarkFormatter: tickMark },
    });
  }, [step, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s) return;
    const has = data != null && data.points.length > 0;
    // Без данных шкалы спрятаны: setData([]) не чистит их диапазон
    chart.applyOptions({
      rightPriceScale: { visible: has },
      leftPriceScale: { visible: has && data.priceError == null },
    });
    if (!data) {
      s.oi.setData([]);
      s.price.setData([]);
      drawnRef.current = null;
      return;
    }
    const { oi, price } = toLines(data);
    s.oi.setData(oi);
    s.price.setData(price);
    if (key(data) !== drawnRef.current) chart.timeScale().fitContent();
    drawnRef.current = key(data);
  }, [data, theme]);

  // Перекрестие → момент точки; на дыре и вне данных — null: легенда
  // покажет последнюю точку
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const times = new Set(data?.points.map((p) => p.t / 1000));
    const k = data ? key(data) : null;
    // Только при смене момента: mousemove внутри одной точки не дёргает
    // рендер. Переподписка после опроса last не теряет: после setData
    // библиотека сама шлёт событие перекрестия (замер T6)
    let last: number | null = null;
    const handler = (param: MouseEventParams<Time>) => {
      const sec = param.time as UTCTimestamp | undefined;
      const t = k && sec != null && times.has(sec) ? sec * 1000 : null;
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
          <Title>Открытые позиции · 30 дней</Title>
          <Market>{data?.market ?? market}</Market>
        </Heading>
        <Tabs>
          {STEPS.map((s) => (
            <StepBtn key={s.value} $active={step === s.value} onClick={() => onStepChange(s.value)}>
              {s.label}
            </StepBtn>
          ))}
        </Tabs>
      </Controls>

      <Legend>
        {loading && <Skeleton $w="480px" $h="12px" />}
        {data && points.length === 0 && <FieldError>Ни одна биржа не ответила</FieldError>}
        {data && shown && (
          <>
            <Value>{formatMoment(shown.t, data.step)}</Value>
            <LegendItem>
              <LegendDot $color={theme.chart.oi} />
              сумма <Strong>${bn(shown.totalUsd)}</Strong>
            </LegendItem>
            {EXCHANGES.map((e) => (
              <LegendItem key={e.id}>
                {e.label}{" "}
                {failed.has(e.id) ? (
                  <FieldError>недоступна</FieldError>
                ) : (
                  <Value>${bn(shown.byExchange[e.id] ?? 0)}</Value>
                )}
              </LegendItem>
            ))}
            <LegendItem>
              <LegendDot $color={theme.chart.oiPrice} />
              цена{" "}
              {/* «—» — в этот момент нет свечи, не ошибка: серым */}
              {shown.price == null ? (
                data.priceError ? <FieldError>недоступна</FieldError> : "—"
              ) : (
                <Value>{fmtPrice(shown.price)}</Value>
              )}
            </LegendItem>
          </>
        )}
      </Legend>

      <Caption>
        Binance + OKX + Bybit — не весь рынок
        {/* Ни одна не ответила — суммы нет, «неполная» не о чем (легенда) */}
        {missing.length > 0 && points.length > 0 && (
          <Missing> · без {missing.join(", ")} — сумма неполная</Missing>
        )}
      </Caption>

      <ChartArea aria-busy={loading}>
        <Box ref={boxRef} />
        {loading && (
          <ChartSkeleton>
            <Skeleton $h="100%" />
          </ChartSkeleton>
        )}
      </ChartArea>

      <Divider />
      {/* Оговорка — фиксированный текст, не AI (как панель TASK-0007) */}
      <Note>
        Сумма — в долларах: растёт и когда открывают новые позиции, и просто когда растёт
        цена. На рост или на падение эти ставки — из графика не видно. Это контекст рядом с
        ценой, а не прогноз.
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

// caption-uppercase системы (DESIGN.md «Typography»)
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
const StepBtn = styled.button<{ $active: boolean }>`
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

const Strong = styled.span`
  color: ${({ theme }) => theme.colors.ink};
  font-weight: 600;
`;

const LegendDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 14px;
  border-top: 2px solid ${({ $color }) => $color};
`;

const Caption = styled.div`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 10px;
`;

const Missing = styled.span`
  color: ${({ theme }) => theme.colors.warning};
`;

const FieldError = styled.span`
  color: ${({ theme }) => theme.colors.warning};
`;

const ChartArea = styled.div`
  position: relative;
`;

const Box = styled.div`
  height: ${HEIGHT}px;
`;

// z-index — над слоями canvas графика
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
