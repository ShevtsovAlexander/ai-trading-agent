import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { Wall } from "../types/orderbook";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export type WallSide = "bid" | "ask";

// Полоса на экране: прямоугольник в медиа-пикселях области свечей
export interface WallBox {
  side: WallSide;
  wall: Wall;
  x: number; // левый край; правый — ширина области
  top: number;
  bottom: number;
}

// Доля ширины области под самую крупную полосу (план, trade-off 7)
export const MAX_SHARE = 0.25;
// Ступень на дневных свечах тоньше пикселя — не тоньше 2 px (план, «Риски»)
export const MIN_THICKNESS = 2;

export interface WallColors {
  bid: string;
  ask: string;
  bidHover: string;
  askHover: string;
}

// Стены стакана у правого края области свечей (TASK-0009): ступень цены —
// по шкале серии свечей, длина ∝ usdt от крупнейшей из 20. Шкалу не
// растягивает (нет autoscaleInfo, trade-off 8): ступень вне видимых цен не
// рисуется и считается «за краем» (onOffscreen — только при смене счёта).
// Раскладку полос читает обработчик перекрестия — наведённая ищется по ней
// (trade-off 9).
export class WallsPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private walls: { bids: Wall[]; asks: Wall[] } = { bids: [], asks: [] };
  private hovered: Wall | null = null;
  private readonly colors: WallColors;
  private readonly view: IPrimitivePaneView;
  // Последняя раскладка: полосы на экране и сколько ступеней за краем
  private boxes: WallBox[] = [];
  private readonly onOffscreen: (count: number) => void;
  private lastOffscreen = -1;

  constructor(colors: WallColors, onOffscreen: (count: number) => void) {
    this.colors = colors;
    this.onOffscreen = onOffscreen;
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.view = { zOrder: () => "normal", renderer: () => renderer };
  }

  attached({ series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return [this.view];
  }

  setData(walls: { bids: Wall[]; asks: Wall[] } | null) {
    this.walls = walls ?? { bids: [], asks: [] };
    this.hovered = null;
    this.requestUpdate?.();
  }

  setHovered(wall: Wall | null) {
    if (wall === this.hovered) return;
    this.hovered = wall;
    this.requestUpdate?.();
  }

  layout() {
    return this.boxes;
  }

  private draw(target: Target) {
    const series = this.series;
    const { bids, asks } = this.walls;
    const all = [
      ...bids.map((wall) => ({ side: "bid" as const, wall })),
      ...asks.map((wall) => ({ side: "ask" as const, wall })),
    ];
    const max = Math.max(0, ...all.map((w) => w.wall.usdt));
    const boxes: WallBox[] = [];
    let offscreen = 0;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { width, height } = mediaSize;
      if (series && max > 0) {
        for (const { side, wall } of all) {
          const a = series.priceToCoordinate(wall.to);
          const b = series.priceToCoordinate(wall.from);
          // Ступень целиком выше или ниже видимых цен — «за краем»
          if (a == null || b == null || b < 0 || a > height) {
            offscreen++;
            continue;
          }
          let top = Math.min(a, b);
          let bottom = Math.max(a, b);
          if (bottom - top < MIN_THICKNESS) {
            const c = (top + bottom) / 2;
            top = c - MIN_THICKNESS / 2;
            bottom = c + MIN_THICKNESS / 2;
          }
          const len = Math.max(1, (wall.usdt / max) * width * MAX_SHARE);
          boxes.push({ side, wall, x: width - len, top, bottom });
        }
      }
      for (const box of boxes) {
        const hover = box.wall === this.hovered;
        ctx.fillStyle =
          box.side === "bid"
            ? hover ? this.colors.bidHover : this.colors.bid
            : hover ? this.colors.askHover : this.colors.ask;
        ctx.fillRect(box.x, box.top, width - box.x, box.bottom - box.top);
      }
    });
    this.boxes = boxes;
    // Наружу — только при смене счёта (draw идёт на каждый кадр); из
    // микротаски — не setState посреди отрисовки библиотеки
    if (offscreen !== this.lastOffscreen) {
      this.lastOffscreen = offscreen;
      const cb = this.onOffscreen;
      queueMicrotask(() => cb(offscreen));
    }
  }
}
