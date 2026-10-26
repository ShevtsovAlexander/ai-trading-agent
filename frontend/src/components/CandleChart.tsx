import { useEffect, useRef } from "react";
import styled, { useTheme } from "styled-components";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  MismatchDirection,
  TickMarkType,
  createChart,
} from "lightweight-charts";
import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LogicalRange,
  MouseEventParams,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { Interval, MarketSeries } from "../types/market";
import { formatCandleTime } from "../utils/candleTime";
import { BandPrimitive } from "./bandPrimitive";
import { seriesKey, toChartData } from "./chartData";
import type { ChartData } from "./chartData";

// Свеча под перекрестием — для легенды над графиком: ключ данных и время
// открытия, не ссылка на объект — опрос приносит новые объекты тех же свечей
export interface HoverPoint {
  key: string; // монета|интервал|диапазон
  t: number;
}

// data — свечи и ряды текущих монеты, интервала и диапазона; null — данных
// для них нет (запрос идёт или упал): график пуст, а не показывает прошлую
// монету
interface Props {
  data: MarketSeries | null;
  interval: Interval;
  withDate: boolean; // диапазон длиннее суток — дата в подписи перекрестия
  // Свеча под перекрестием; null — перекрестия нет или оно на разрыве
  onHover: (p: HoverPoint | null) => void;
  // Слева видно меньше EDGE_BARS скрытых баров — нужен кусок истории.
  // Зовётся на каждом сдвиге у края: лишние вызовы гасит хук истории
  // (кусок в пути, начало истории, потолок)
  onNeedMore: () => void;
  complete: boolean; // левее свечей у Binance нет — дальше не листается
  // Время крайних видимых свечей, мс; null — данных нет
  onVisibleRange: (r: { from: number; to: number } | null) => void;
}

const HEIGHT = 360;
// Запас баров слева, при котором грузится следующий кусок
const EDGE_BARS = 200;

const Box = styled.div`
  height: ${HEIGHT}px;
`;

interface Drawn {
  key: string;
  first: UTCTimestamp;
  last: UTCTimestamp;
}

// Точка любой серии: у всех рядов toChartData одно и то же время по индексу
type Point = ChartData["candles"][number] | ChartData["ema9"][number];

interface Series {
  candles: ISeriesApi<"Candlestick">;
  ema9: ISeriesApi<"Line">;
  ema21: ISeriesApi<"Line">;
  bbUpper: ISeriesApi<"Line">;
  bbLower: ISeriesApi<"Line">;
  band: BandPrimitive;
}

// Подписи оси — местное время ru-RU, как в таблице и тултипе: ось
// lightweight-charts по умолчанию рисует UTC
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

export const CandleChart = ({
  data,
  interval,
  withDate,
  onHover,
  onNeedMore,
  complete,
  onVisibleRange,
}: Props) => {
  const theme = useTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Series | null>(null);
  // Последние нарисованные данные: ключ (монета|интервал|диапазон) и время
  // крайних свечей. fitContent — только при смене ключа: опрос не сбрасывает
  // зум и прокрутку. Тот же ключ и левый край не уехал вправо — опрос и
  // догрузка истории: правые свечи через update(), не setData (замер T1)
  const drawnRef = useRef<Drawn | null>(null);
  // Линия текущей цены — своя, не встроенная метка серии: та показывает
  // цену последней ВИДИМОЙ свечи, и при зуме в историю жёлтым подписывалась
  // бы старая цена (критик T5)
  const lastPriceRef = useRef<IPriceLine | null>(null);

  // Создание — один раз. Очистка remove() обязательна: StrictMode в dev
  // монтирует эффект дважды, без неё в контейнере два графика
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
      // Вправо за последнюю свечу не уводится: правее данных нет
      timeScale: { borderColor: theme.colors.hairline, fixRightEdge: true },
    });
    // Точность — как у бэкенда (round до 2 знаков)
    const priceFormat = { type: "price" as const, precision: 2, minMove: 0.01 };
    const line = {
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat,
    };
    // Границы BB — пунктир; заливка между ними — примитив под свечами
    const bandLine = { ...line, color: theme.chart.bandLine, lineStyle: LineStyle.Dashed };
    const candles = chart.addSeries(CandlestickSeries, {
        upColor: theme.colors.up,
        downColor: theme.colors.down,
        wickUpColor: theme.colors.up,
        wickDownColor: theme.colors.down,
        borderVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat,
      });
    const band = new BandPrimitive(theme.chart.bandFill);
    candles.attachPrimitive(band);
    seriesRef.current = {
      candles,
      bbUpper: chart.addSeries(LineSeries, bandLine),
      bbLower: chart.addSeries(LineSeries, bandLine),
      ema9: chart.addSeries(LineSeries, { ...line, color: theme.chart.emaFast }),
      ema21: chart.addSeries(LineSeries, { ...line, color: theme.chart.emaSlow }),
      band,
    };
    chartRef.current = chart;

    // Canvas не перерисовывается сам, когда догружается веб-шрифт: без этого
    // подписи осей остались бы системным моноширинным
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
      lastPriceRef.current = null;
    };
  }, [theme]);

  // Подпись перекрестия — та же, что в таблице: одна свеча — одна подпись
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        timeFormatter: (time: Time) =>
          formatCandleTime((time as UTCTimestamp) * 1000, interval, withDate),
      },
      timeScale: { timeVisible: interval !== "1d", tickMarkFormatter: tickMark },
    });
  }, [interval, withDate, theme]);

  // Обработчик края зовёт актуальный onNeedMore: событие диапазона приходит
  // синхронно внутри setData, до переподписки эффектом ниже, — со старым
  // замыканием ушёл бы запрос по прежнему левому краю (критик T6). Эффект
  // объявлен раньше эффекта данных: к их setData ref уже свежий. Окно между
  // коммитом и эффектами ref не закрывает — событие там зовёт onNeedMore
  // прошлого рендера; дубль запроса гасит lastRef в useChartHistory
  const needMoreRef = useRef(onNeedMore);
  const visibleRef = useRef(onVisibleRange);
  useEffect(() => {
    needMoreRef.current = onNeedMore;
    visibleRef.current = onVisibleRange;
  }, [onNeedMore, onVisibleRange]);

  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s) return;
    // Без данных шкала цены спрятана: setData([]) серии чистит, а диапазон
    // шкалы — нет, и на пустом графике висели бы цены прошлой монеты
    chart.applyOptions({ rightPriceScale: { visible: data != null } });
    if (lastPriceRef.current) {
      s.candles.removePriceLine(lastPriceRef.current);
      lastPriceRef.current = null;
    }
    if (!data) {
      s.candles.setData([]);
      s.ema9.setData([]);
      s.ema21.setData([]);
      s.bbUpper.setData([]);
      s.bbLower.setData([]);
      s.band.setData({ bbUpper: [], bbLower: [] });
      drawnRef.current = null;
      return;
    }
    // Интервал — из самих данных: порог разрыва не зависит от того, что
    // App отфильтровал data по текущему интервалу
    const d = toChartData(data, data.interval);
    const key = seriesKey(data);
    const prev = drawnRef.current;
    const first = d.candles[0]?.time;
    const end = d.candles[d.candles.length - 1]?.time;
    // Индекс прежней последней свечи: левее неё ряд прежний (или с куском
    // истории слева), правее — новое от опроса
    const cut =
      prev && prev.key === key && first != null && first <= prev.first && end >= prev.last
        ? d.candles.findIndex((p) => p.time === prev.last)
        : -1;
    const pairs = [
      [s.candles, d.candles],
      [s.ema9, d.ema9],
      [s.ema21, d.ema21],
      [s.bbUpper, d.bbUpper],
      [s.bbLower, d.bbLower],
    ] as unknown as [ISeriesApi<SeriesType>, Point[]][];
    if (cut === -1) {
      // Смена ключа, сброс истории (левый край уехал вправо), пустой ряд
      for (const [api, pts] of pairs) api.setData(pts);
    } else {
      // Кусок слева и опрос справа — разными обновлениями: в одном setData
      // вид сдвигается на бар (критик T1). Прежнюю последнюю точку update()
      // переписывает: перед новым разрывом её цвет становится BRIDGE
      const prefix = first! < prev!.first;
      for (const [api, pts] of pairs) {
        if (prefix) api.setData(pts.slice(0, cut + 1));
        for (let i = prefix ? cut + 1 : cut; i < pts.length; i++) api.update(pts[i]);
      }
    }
    s.band.setData(d);
    const last = data.candles[data.candles.length - 1];
    if (last) {
      // Текущая цена — место жёлтого «в» (план, вопрос 4)
      lastPriceRef.current = s.candles.createPriceLine({
        price: last.close,
        color: theme.colors.primary,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        axisLabelColor: theme.colors.primary,
        axisLabelTextColor: theme.colors.onPrimary,
      });
    }
    if (key !== prev?.key) chart.timeScale().fitContent();
    drawnRef.current = first != null ? { key, first, last: end } : null;
  }, [data, theme]);

  // Начало истории у Binance — левый край прибит к первой свече
  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { fixLeftEdge: complete } });
  }, [complete, theme]);

  // Подход к левому краю → следующий кусок. Позицию при добавлении слева
  // библиотека держит сама; ручной сдвиг её ломает (замер T1)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const handler = (range: LogicalRange | null) => {
      const bars = range && seriesRef.current?.candles.barsInLogicalRange(range);
      if (bars && bars.barsBefore < EDGE_BARS) needMoreRef.current();
    };
    ts.subscribeVisibleLogicalRangeChange(handler);
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler);
  }, [theme]);

  // Новый onNeedMore (данные, конец паузы после ошибки куска) — край
  // перепроверяется без события диапазона: у предела прокрутки вид не
  // двигается, и повтор иначе ждал бы, пока пользователь отъедет и вернётся.
  // После эффекта данных — по уже нарисованному ряду
  useEffect(() => {
    const range = chartRef.current?.timeScale().getVisibleLogicalRange();
    const bars = range && seriesRef.current?.candles.barsInLogicalRange(range);
    if (bars && bars.barsBefore < EDGE_BARS) onNeedMore();
  }, [onNeedMore]);

  // Видимый отрезок → подпись «от – до» над графиком и дата в подписях.
  // Крайние — свечи под крайними пикселями, как у перекрестия
  // (coordinateToLogical). Края логического диапазона сдвинуты от пикселей
  // примерно на полсвечи: и getVisibleRange, и округление from/to
  // расходились с перекрестием у края на свечу (приёмка T9)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const handler = (r: LogicalRange | null) => {
      const s = seriesRef.current?.candles;
      const left = ts.coordinateToLogical(0);
      const right = ts.coordinateToLogical(ts.width() - 1);
      const a = r && left != null && s?.dataByIndex(left, MismatchDirection.NearestRight);
      const b = r && right != null && s?.dataByIndex(right, MismatchDirection.NearestLeft);
      visibleRef.current(
        a && b
          ? { from: (a.time as UTCTimestamp) * 1000, to: (b.time as UTCTimestamp) * 1000 }
          : null,
      );
    };
    ts.subscribeVisibleLogicalRangeChange(handler);
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler);
  }, [theme]);

  // Перекрестие → свеча по времени открытия. На разрыве (пустая точка) и вне
  // данных — null: легенда покажет последнюю свечу
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const times = new Set(data?.candles.map((c) => c.t / 1000));
    const key = data ? seriesKey(data) : null;
    // Только при смене свечи: mousemove внутри одной свечи не дёргает рендер
    let last: number | null = null;
    const handler = (param: MouseEventParams<Time>) => {
      const sec = param.time as UTCTimestamp | undefined;
      const t = key && sec != null && times.has(sec) ? sec * 1000 : null;
      if (t === last) return;
      last = t;
      onHover(key && t != null ? { key, t } : null);
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [data, onHover, theme]);

  return <Box ref={boxRef} />;
};
