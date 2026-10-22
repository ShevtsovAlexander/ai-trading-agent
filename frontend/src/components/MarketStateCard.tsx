import styled, { useTheme, type DefaultTheme } from 'styled-components';
import { INTERVAL_LABELS, INTERVAL_MS } from '../types/market';
import { formatCandleTime } from '../utils/candleTime';
import type { Interval, MarketView } from '../types/market';

interface Props {
    data: MarketView;
}

const TREND_LABELS = {
    up: '↑ Рост',
    down: '↓ Падение',
    flat: '→ Боковик',
};

// --- styled ---

const Container = styled.div`
    background: ${({ theme }) => theme.colors.surfaceCard};
    border: 1px solid ${({ theme }) => theme.colors.hairline};
    border-radius: ${({ theme }) => theme.radius.lg};
    padding: 16px;
`;

const Header = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
`;

const Market = styled.div`
    font-size: ${({ theme }) => theme.fontSize.base};
    font-weight: 600;
    color: ${({ theme }) => theme.colors.ink};
`;

const Candle = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.muted};
`;

// Цена — stat-callout системы: жёлтая, Inter 700 с отрицательным
// трекингом. Место «б» из плана (вопрос 4)
const Price = styled.div`
    font-size: ${({ theme }) => theme.fontSize.display};
    font-weight: 700;
    letter-spacing: -0.5px;
    line-height: 1;
    color: ${({ theme }) => theme.colors.primary};
`;

const PriceBlock = styled.div`
    margin-bottom: 12px;
`;

const StatsGrid = styled.div`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 12px;
`;

const Stat = styled.div``;

const StatLabel = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.muted};
    margin-bottom: 2px;
`;

const StatValue = styled.div<{ $color?: string }>`
    font-family: ${({ theme }) => theme.font.mono};
    font-size: ${({ theme }) => theme.fontSize.md};
    font-weight: 500;
    color: ${({ $color, theme }) => $color ?? theme.colors.bodyStrong};
`;

const Divider = styled.div`
    border-top: 1px solid ${({ theme }) => theme.colors.hairline};
    margin: 10px 0;
`;

// caption-uppercase системы (DESIGN.md «Typography»)
const SectionTitle = styled.div`
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${({ theme }) => theme.colors.muted};
    margin-bottom: 8px;
`;

const AiReasoning = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.body};
  line-height: 1.5;
  font-style: italic;
`;

// --- helpers ---

const fmt = (val: number | null | undefined, prefix = '') =>
    val != null ? `${prefix}${val.toLocaleString()}` : '—';

const rsiColor = (rsi: number | null, theme: DefaultTheme) => {
    if (rsi == null) return undefined;
    if (rsi < 35) return theme.colors.up;
    if (rsi > 65) return theme.colors.down;
    return undefined;
};

const macdColor = (histogram: number | null, theme: DefaultTheme) => {
    if (histogram == null) return undefined;
    return histogram > 0 ? theme.colors.up : theme.colors.down;
};

// Свеча — от открытия до закрытия: closedAt — последняя миллисекунда, +1
// даёт ровную границу. Подпись открытия — та же, что в тултипе и таблице;
// дневная свеча — одной датой.
const candleLabel = (closedAt: number, interval: Interval) => {
    const open = closedAt + 1 - INTERVAL_MS[interval];
    if (interval === '1d') return formatCandleTime(open, interval, true);
    const withDate = INTERVAL_MS[interval] >= INTERVAL_MS['1h'];
    const close = new Date(closedAt + 1).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
    });
    return `${formatCandleTime(open, interval, withDate)}–${close}`;
};

// --- component ---

export const MarketStateCard = ({ data }: Props) => {
    const theme = useTheme();
    // Индикаторы — на последней закрытой свече интервала
    const { ema9, ema21, rsi } = data.latest;

    const macd = data.latest.macd != null ? {
        macd: data.latest.macd,
        signal: data.latest.macdSignal!,
        histogram: data.latest.macdHistogram!,
    } : null;

    const bb = data.latest.bbUpper != null ? {
        upper: data.latest.bbUpper,
        middle: data.latest.bbMiddle!,
        lower: data.latest.bbLower!,
        bandwidth: data.latest.bbBandwidth!,
    } : null;

    return (
        <Container>
            <Header>
                <Market>{data.market}</Market>
                <Candle>
                    свеча {INTERVAL_LABELS[data.interval]} ·{' '}
                    {candleLabel(data.closedAt, data.interval)}
                </Candle>
            </Header>

            {/* Цена — отдельной строкой: крупный шрифт не влезает в колонку */}
            <PriceBlock>
                <StatLabel>Цена</StatLabel>
                <Price>${data.price.toLocaleString()}</Price>
            </PriceBlock>

            {/* MA5 + тренд */}
            <StatsGrid>
                <Stat>
                    <StatLabel>MA5</StatLabel>
                    <StatValue>{fmt(data.ma5, '$')}</StatValue>
                </Stat>
                <Stat>
                    <StatLabel>Тренд</StatLabel>
                    <StatValue>{TREND_LABELS[data.trend]}</StatValue>
                </Stat>
            </StatsGrid>

            {/* EMA + RSI */}
            <StatsGrid>
                <Stat>
                    <StatLabel>EMA 9</StatLabel>
                    <StatValue>{fmt(ema9, '$')}</StatValue>
                </Stat>
                <Stat>
                    <StatLabel>EMA 21</StatLabel>
                    <StatValue>{fmt(ema21, '$')}</StatValue>
                </Stat>
                <Stat>
                    <StatLabel>RSI</StatLabel>
                    <StatValue $color={rsiColor(rsi, theme)}>{fmt(rsi)}</StatValue>
                </Stat>
            </StatsGrid>

            {/* MACD */}
            {macd && (
                <StatsGrid>
                    <Stat>
                        <StatLabel>MACD</StatLabel>
                        <StatValue>{macd.macd.toFixed(2)}</StatValue>
                    </Stat>
                    <Stat>
                        <StatLabel>Signal</StatLabel>
                        <StatValue>{macd.signal.toFixed(2)}</StatValue>
                    </Stat>
                    <Stat>
                        <StatLabel>Histogram</StatLabel>
                        <StatValue $color={macdColor(macd.histogram, theme)}>
                            {macd.histogram.toFixed(2)}
                        </StatValue>
                    </Stat>
                </StatsGrid>
            )}

            {/* Bollinger Bands */}
            {bb && (
                <StatsGrid>
                    <Stat>
                        <StatLabel>BB Upper</StatLabel>
                        <StatValue>${bb.upper.toLocaleString()}</StatValue>
                    </Stat>
                    <Stat>
                        <StatLabel>BB Lower</StatLabel>
                        <StatValue>${bb.lower.toLocaleString()}</StatValue>
                    </Stat>
                    <Stat>
                        <StatLabel>BW</StatLabel>
                        <StatValue>{bb.bandwidth.toFixed(2)}%</StatValue>
                    </Stat>
                </StatsGrid>
            )}


            <Divider />

            <SectionTitle>AI</SectionTitle>
            <AiReasoning>{data.aiComment}</AiReasoning>
        </Container>
    );
};