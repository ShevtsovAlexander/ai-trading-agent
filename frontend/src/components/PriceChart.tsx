import { useState } from "react";
import styled, { useTheme } from "styled-components";
import { INTERVAL_LABELS, RANGE_MS, isAllowed } from "../types/market";
import type { Interval, MarketSeries, Range } from "../types/market";
import { formatCandleTime } from "../utils/candleTime";
import { CandleChart } from "./CandleChart";
import { Skeleton } from "./Skeleton";
import { seriesKey } from "./chartData";
import type { HoverPoint } from "./CandleChart";
import type { OrderBookSnapshot, Wall } from "../types/orderbook";
import type { WallSide } from "./wallsPrimitive";
import { InfoHint } from "./InfoHint";
import { BLOCK_HINT_LABEL, BLOCK_HINTS, HintSlot } from "./blockHints";

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
  loading?: boolean; // данные в пути (TASK-0005) — плашки поверх пустого графика
  onNeedMore: () => void; // подход к левому краю — кусок истории
  complete: boolean; // начало истории у Binance
  historyLoading: boolean; // кусок истории в пути
  historyError: string | null; // кусок не загрузился (502/429/нет связи)
  capped: boolean; // потолок баров — глубже не грузится
  orderBook: OrderBookSnapshot | null; // стакан текущей монеты (TASK-0009)
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
  background: ${({ theme }) => theme.colors.surfaceCard};
  border: 1px solid ${({ theme }) => theme.colors.hairline};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
`;

// caption-uppercase системы (DESIGN.md «Typography»)
const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 4px;
`;

// Заголовок и подпись видимого отрезка в одну строку
const Heading = styled.div`
  display: flex;
  align-items: baseline;
  gap: 12px;
`;

// «от – до» крайних видимых свечей (PRD крит. 10)
const VisibleSpan = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.muted};
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

// Плашка — поверх пустого графика, не вместо него: lightweight-charts
// живёт в контейнере и не пересоздаётся при каждой загрузке
const ChartArea = styled.div`
  position: relative;
`;

// z-index — над слоями canvas графика, у них свой z-index
const ChartSkeleton = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
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
  color: ${({ theme }) => theme.colors.mutedSoft};
`;

const Separator = styled.span`
  width: 1px;
  height: 14px;
  background: ${({ theme }) => theme.colors.hairline};
`;

// category-tab системы, mono. Активная — surfaceElevated, не surfaceCard
// из DESIGN.md: кнопки лежат на карточке того же цвета и слились бы с ней
// (решение человека, TASK-0003.7)
const RangeBtn = styled.button<{ $active: boolean }>`
  padding: 3px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: none;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.surfaceElevated : "transparent"};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.ink : theme.colors.muted};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;

// Метка у левого края графика: догрузка, её ошибка, начало истории,
// потолок. z-index — над слоями canvas, как у скелетона
const HistoryNote = styled.div`
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
  padding: 3px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: 1px solid ${({ theme }) => theme.colors.hairline};
  background: ${({ theme }) => theme.colors.surfaceElevated};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.muted};
  pointer-events: none;
`;

// Плашка наведённой полосы стакана — у правого верхнего угла, левее шкалы
// цены (полосы — у правого края области свечей)
const WallNote = styled(HistoryNote)`
  left: auto;
  right: 72px;
  color: ${({ theme }) => theme.colors.body};
`;

// Строка стакана под графиком: источник, время снимка, охват, ступень
const WallsInfo = styled.div`
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.muted};
`;

const WallsWarning = styled.span`
  color: ${({ theme }) => theme.colors.warning};
`;

// Оговорка — фиксированный текст, не AI (PRD, критерий 5)
const WallsDisclaimer = styled.div`
  margin-top: 4px;
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.mutedSoft};
`;

const EXCHANGE_LABEL = { binance: "Binance", okx: "OKX" } as const;

const ru = (v: number, min: number, max: number) =>
  v.toLocaleString("ru-RU", { minimumFractionDigits: min, maximumFractionDigits: max });

// Цена границы ступени: у шага меньше доллара — копейки всегда; граница по
// mid бывает дробной и у шага $10 — до 2 знаков
const fmtPrice = (v: number, step: number) => ru(v, step < 1 ? 2 : 0, 2);

// Объём в монетах: крупный — целым, мелкий — с долями
// Доля меньше 0,001 не показывается нулём — заявки есть (критик T7)
const fmtCoin = (v: number) =>
  v >= 100 ? ru(v, 0, 0) : v >= 1 ? ru(v, 0, 2) : v >= 0.001 ? ru(v, 0, 3) : "< 0,001";

// Котировка — USDT, не доллары (PRD, «Риски»)
const fmtUsdt = (v: number) =>
  v >= 1e6 ? `${ru(v / 1e6, 1, 1)} млн USDT` : v >= 1e3 ? `${ru(v / 1e3, 0, 0)} тыс. USDT` : `${ru(v, 0, 0)} USDT`;

const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${ru(Math.abs(v), 2, 2)} %`;

// «78 000–78 010 · покупка 50 BTC · 3,9 млн USDT · Binance 20 · OKX 30»
const wallText = (side: WallSide, w: Wall, step: number, label: string) =>
  [
    `${fmtPrice(w.from, step)}–${fmtPrice(w.to, step)}`,
    `${side === "bid" ? "покупка" : "продажа"} ${fmtCoin(w.coin)} ${label}`,
    fmtUsdt(w.usdt),
    ...(["binance", "okx"] as const)
      .filter((ex) => w.byExchange[ex] != null)
      .map((ex) => `${EXCHANGE_LABEL[ex]} ${fmtCoin(w.byExchange[ex]!)}`),
  ].join(" · ");

// --- component ---

export const PriceChart = ({
  data,
  coin,
  interval,
  range,
  onRangeChange,
  onIntervalChange,
  loading = false,
  onNeedMore,
  complete,
  historyLoading,
  historyError,
  capped,
  orderBook,
}: Props) => {
  const theme = useTheme();
  const [wallHover, setWallHover] = useState<{ side: WallSide; wall: Wall } | null>(null);
  const [offscreen, setOffscreen] = useState(0);
  // Без свечей полос нет — и строки стакана тоже
  const book = data && data.candles.length > 0 ? orderBook : null;
  const down = book?.exchanges.filter((e) => "error" in e).map((e) => EXCHANGE_LABEL[e.exchange]) ?? [];
  const [hover, setHover] = useState<HoverPoint | null>(null);
  // Видимый отрезок графика (мс): после прокрутки и зума он, а не кнопка
  // периода, решает, нужна ли дата в подписях
  const [visible, setVisible] = useState<{ from: number; to: number } | null>(null);
  // Дата в подписи перекрестия и легенды — если на экране больше суток.
  // Пока отрезок неизвестен — по кнопке периода, как раньше
  const span = visible ? visible.to - visible.from : RANGE_MS[range];
  const withDate = span > RANGE_MS["24h"];
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
  // Начало истории и потолок — только когда левый край данных на экране:
  // иначе на 1д метка листинга висела бы над 2026 годом
  const atStart = data != null && n > 0 && visible != null && visible.from <= data.candles[0].t;
  const note = historyLoading
    ? "загрузка истории…"
    : historyError
      ? `история не загрузилась: ${historyError}`
      : atStart && complete
        ? `начало истории ${coin.market} на Binance — ${formatCandleTime(data.candles[0].t, interval, true)}`
        : atStart && capped
          ? "глубже — переключись на свечу крупнее"
          : null;

  return (
    <Container>
      <Controls>
        <Heading>
          <Title>
            {coin.market} — цена / EMA / BB
            <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.price}</InfoHint></HintSlot>
          </Title>
          {/* Дата — всегда: «09:00 – 21:00» в прошлом не говорит, какой день */}
          {data && visible && (
            <VisibleSpan>
              {formatCandleTime(visible.from, interval, true)} –{" "}
              {formatCandleTime(visible.to, interval, true)}
            </VisibleSpan>
          )}
        </Heading>
        <Selectors>
          <SelectorLabel>свеча</SelectorLabel>
          <RangeTabs>
            {INTERVALS.map((iv) => (
              <RangeBtn
                key={iv}
                $active={interval === iv}
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
              $active={range === r.value}
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
        {loading && <Skeleton $w="560px" $h="12px" />}
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

      <ChartArea aria-busy={loading}>
        <CandleChart
          data={data}
          interval={interval}
          withDate={withDate}
          onHover={setHover}
          onNeedMore={onNeedMore}
          complete={complete}
          onVisibleRange={setVisible}
          walls={book}
          onWallHover={setWallHover}
          onWallsOffscreen={setOffscreen}
        />
        {data && note && <HistoryNote>{note}</HistoryNote>}
        {book && wallHover && (
          <WallNote>{wallText(wallHover.side, wallHover.wall, book.step, coin.label)}</WallNote>
        )}
        {loading && (
          <ChartSkeleton>
            <Skeleton $h="100%" />
          </ChartSkeleton>
        )}
      </ChartArea>

      {book && (
        <>
          <WallsInfo>
            {book.mid == null || book.coverage == null ? (
              <WallsWarning>Стакан: ни одна биржа не ответила</WallsWarning>
            ) : (
              <>
                <span>
                  Стакан {down.length ? EXCHANGE_LABEL[book.exchanges.find((e) => !("error" in e))!.exchange] : "Binance + OKX"}, спот
                </span>
                <span>снимок {new Date(book.at).toLocaleTimeString("ru-RU")}</span>
                <span>
                  охват {fmtPct((book.coverage.bid / book.mid - 1) * 100)} /{" "}
                  {fmtPct((book.coverage.ask / book.mid - 1) * 100)}
                </span>
                <span>ступень {fmtPrice(book.step, book.step)} USDT</span>
                {offscreen > 0 && <span>ещё {offscreen} за краем графика</span>}
                {down.length > 0 && (
                  <WallsWarning>без {down.join(" и ")} — сумма неполная</WallsWarning>
                )}
              </>
            )}
          </WallsInfo>
          {/* Без полос (обе биржи не ответили) про «20 ступеней» молчим
              (критик T8) */}
          {book.mid != null && (
            <WallsDisclaimer>
              Полосы — 20 крупнейших ступеней заявок прямо сейчас (10 на покупку ниже цены,
              10 на продажу выше). Заявку могут снять в любой момент, часть объёма не видна
              (скрытые заявки, другие биржи). Это снимок, не прогноз и не гарантия, что цена
              на ней остановится.
            </WallsDisclaimer>
          )}
        </>
      )}
    </Container>
  );
};
