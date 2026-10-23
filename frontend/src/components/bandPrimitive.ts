import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { ChartData } from "./chartData";

// Холст отрисовки — тип из самой библиотеки, без прямого импорта fancy-canvas
type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type Band = Pick<ChartData, "bbUpper" | "bbLower">;

// Заливка полосы Боллинджера между bbUpper[i] и bbLower[i]. Встроенной
// «заливки между двумя линиями» в lightweight-charts нет (план, trade-off 2).
// Границы рисуют сами линии-серии; здесь — только площадь под свечами.
// Пустая точка (разрыв Binance или null в начале ряда) рвёт заливку.
export class BandPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private band: Band = { bbUpper: [], bbLower: [] };
  private readonly color: string;
  private readonly view: IPrimitivePaneView;

  constructor(color: string) {
    this.color = color;
    const renderer: IPrimitivePaneRenderer = {
      draw: () => {},
      drawBackground: (target) => this.draw(target),
    };
    this.view = { zOrder: () => "bottom", renderer: () => renderer };
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return [this.view];
  }

  setData(band: Band) {
    this.band = band;
    this.requestUpdate?.();
  }

  private draw(target: Target) {
    const { chart, series } = this;
    if (!chart || !series) return;
    const ts = chart.timeScale();
    const { bbUpper, bbLower } = this.band;

    // Сплошные куски: подряд идущие точки, где обе границы есть
    const pieces: { x: number; up: number; low: number }[][] = [];
    let piece: { x: number; up: number; low: number }[] = [];
    // Только видимые бары (±1 — край заливки за кромкой): обход всего ряда
    // на 100 тыс. барах — 28 мс на кадр, по видимому — ≤ 4 мс (замер T1).
    // Логический индекс = индекс в массиве: все ряды одной длины, разрывы общие
    const vr = ts.getVisibleLogicalRange();
    if (!vr) return;
    const from = Math.max(0, Math.floor(vr.from) - 1);
    const to = Math.min(bbUpper.length - 1, Math.ceil(vr.to) + 1);
    for (let i = from; i <= to; i++) {
      const u = bbUpper[i];
      const l = bbLower[i];
      const x = ts.timeToCoordinate(u.time);
      const up = "value" in u ? series.priceToCoordinate(u.value) : null;
      const low = "value" in l ? series.priceToCoordinate(l.value) : null;
      if (x == null || up == null || low == null) {
        if (piece.length) pieces.push(piece);
        piece = [];
        continue;
      }
      piece.push({ x, up, low });
    }
    if (piece.length) pieces.push(piece);

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.fillStyle = this.color;
      for (const p of pieces) {
        if (p.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].up);
        for (const q of p) ctx.lineTo(q.x, q.up);
        for (let j = p.length - 1; j >= 0; j--) ctx.lineTo(p[j].x, p[j].low);
        ctx.closePath();
        ctx.fill();
      }
    });
  }
}
