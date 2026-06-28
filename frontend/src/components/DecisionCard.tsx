import styled from 'styled-components';
import type { TradeDecision, AnalyzeResponse } from '../types/trading';

interface Props {
    data: TradeDecision | AnalyzeResponse;
}

const DECISION_COLORS = {
    BUY: '#4ade80',
    SELL: '#f87171',
    SKIP: '#f59e0b',
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

const Badge = styled.span<{ decision: 'BUY' | 'SELL' | 'SKIP' }>`
    padding: 3px 12px;
    border-radius: ${({ theme }) => theme.radius.sm};
    font-size: ${({ theme }) => theme.fontSize.md};
    font-weight: 600;
    background: ${({ decision }) => `${DECISION_COLORS[decision]}22`};
    color: ${({ decision }) => DECISION_COLORS[decision]};
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

const BarRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
`;

const BarLabel = styled.span`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.textMuted};
    width: 80px;
`;

const BarTrack = styled.div`
    flex: 1;
    height: 4px;
    background: ${({ theme }) => theme.colors.border};
    border-radius: 99px;
    overflow: hidden;
`;

const BarFill = styled.div<{ width: number; color: string }>`
    height: 100%;
    width: ${({ width }) => Math.min(width, 100)}%;
    background: ${({ color }) => color};
    border-radius: 99px;
`;

const BarValue = styled.span`
    font-size: ${({ theme }) => theme.fontSize.sm};
    font-weight: 500;
    color: ${({ theme }) => theme.colors.text};
    width: 32px;
    text-align: right;
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

const Reason = styled.p`
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.textSecondary};
    line-height: 1.5;
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

// --- component ---

export const DecisionCard = ({ data }: Props) => {
    const { ema9, ema21, rsi } = data;

    const isAnalyzeResponse = (d: TradeDecision | AnalyzeResponse): d is AnalyzeResponse =>
        'macd' in d && d.macd != null;

    const macd = isAnalyzeResponse(data) ? data.macd : data.macdValue != null ? {
        macd: data.macdValue,
        signal: data.macdSignal!,
        histogram: data.macdHistogram!,
    } : null;

    const bb = isAnalyzeResponse(data) ? data.bb : data.bbUpper != null ? {
        upper: data.bbUpper,
        middle: data.bbMiddle!,
        lower: data.bbLower!,
        bandwidth: data.bbBandwidth!,
    } : null;

    return (
        <Container>
            <Header>
                <Market>{data.market}</Market>
                <Badge decision={data.decision}>{data.decision}</Badge>
            </Header>

            {/* Цена + MA5 + тренд */}
            <StatsGrid>
                <Stat>
                    <StatLabel>Цена</StatLabel>
                    <StatValue>${data.currentPrice.toLocaleString()}</StatValue>
                </Stat>
                <Stat>
                    <StatLabel>MA5</StatLabel>
                    <StatValue>{fmt(data.movingAverage, '$')}</StatValue>
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

            {/* Уверенность + риск */}
            <BarRow>
                <BarLabel>Уверенность</BarLabel>
                <BarTrack>
                    <BarFill width={data.confidence} color="#a78bfa" />
                </BarTrack>
                <BarValue>{data.confidence}%</BarValue>
            </BarRow>

            <BarRow>
                <BarLabel>Риск</BarLabel>
                <BarTrack>
                    <BarFill width={data.riskScore * 10} color="#f59e0b" />
                </BarTrack>
                <BarValue>{data.riskScore}/10</BarValue>
            </BarRow>

            {/* Expected Value */}
            <BarRow>
                <BarLabel>EV</BarLabel>
                <BarTrack>
                    <BarFill
                        width={Math.abs(data.expectedValue) * 10000}
                        color={data.expectedValue >= 0 ? '#4ade80' : '#f87171'}
                    />
                </BarTrack>
                <BarValue style={{ width: 60 }}>
                    {data.expectedValue >= 0 ? '+' : ''}{data.expectedValue.toFixed(4)}
                </BarValue>
            </BarRow>

            <Divider />

            <SectionTitle>Сигналы</SectionTitle>
            <Reason>{data.reason}</Reason>

            <SectionTitle>AI</SectionTitle>
            <AiReasoning>{data.aiReasoning}</AiReasoning>
        </Container>
    );
};