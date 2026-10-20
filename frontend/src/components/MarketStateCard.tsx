import styled from 'styled-components';
import { INTERVAL_MS } from '../types/market';
import type { Interval, MarketView } from '../types/market';

interface Props {
    data: MarketView;
}

const INTERVAL_LABELS: Record<Interval, string> = {
    '1m': '1м',
    '5m': '5м',
    '15m': '15м',
    '1h': '1ч',
    '4h': '4ч',
    '1d': '1д',
};

const TREND_LABELS = {
    up: '↑ Рост',
    down: '↓ Падение',
    flat: '→ Боковик',
};

// --- styled ---

const Container = styled.div`
    background: ${({ theme }) => theme.colors.surface};
    border: 1px solid ${({ theme }) => theme.colors.border};
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
    color: ${({ theme }) => theme.colors.text};
`;

const Candle = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.textMuted};
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
    color: ${({ theme }) => theme.colors.textMuted};
    margin-bottom: 2px;
`;

const StatValue = styled.div<{ color?: string }>`
    font-size: ${({ theme }) => theme.fontSize.md};
    font-weight: 500;
    color: ${({ color, theme }) => color ?? theme.colors.text};
`;

const Divider = styled.div`
    border-top: 1px solid ${({ theme }) => theme.colors.border};
    margin: 10px 0;
`;

const SectionTitle = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.textMuted};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
`;

const AiReasoning = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.textMuted};
  line-height: 1.5;
  font-style: italic;
`;

// --- helpers ---

const fmt = (val: number | null | undefined, prefix = '') =>
    val != null ? `${prefix}${val.toLocaleString()}` : '—';

const rsiColor = (rsi: number | null) => {
    if (rsi == null) return undefined;
    if (rsi < 35) return '#4ade80';
    if (rsi > 65) return '#f87171';
    return undefined;
};

const macdColor = (histogram: number | null) => {
    if (histogram == null) return undefined;
    return histogram > 0 ? '#4ade80' : '#f87171';
};

// Время закрытия свечи: closedAt — последняя миллисекунда, +1 даёт ровную
// границу (18:20, а не 18:19). Дата — для свечей от часа: закрытие может
// быть не сегодня.
const closedLabel = (closedAt: number, interval: Interval) =>
    new Date(closedAt + 1).toLocaleString('ru-RU', {
        ...(INTERVAL_MS[interval] >= INTERVAL_MS['1h'] && {
            day: 'numeric',
            month: 'short',
        }),
        hour: '2-digit',
        minute: '2-digit',
    });

// --- component ---

export const MarketStateCard = ({ data }: Props) => {
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
                    свеча {INTERVAL_LABELS[data.interval]} · закрыта{' '}
                    {closedLabel(data.closedAt, data.interval)}
                </Candle>
            </Header>

            {/* Цена + MA5 + тренд */}
            <StatsGrid>
                <Stat>
                    <StatLabel>Цена</StatLabel>
                    <StatValue>${data.price.toLocaleString()}</StatValue>
                </Stat>
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
                    <StatValue color={rsiColor(rsi)}>{fmt(rsi)}</StatValue>
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
                        <StatValue color={macdColor(macd.histogram)}>
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