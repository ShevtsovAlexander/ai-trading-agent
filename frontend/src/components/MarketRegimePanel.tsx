import styled from 'styled-components';
import { Skeleton } from './Skeleton';
import { REGIME_LABELS } from '../types/market';
import type { MarketRegime } from '../types/market';

interface Props {
    data: MarketRegime;
}

// --- helpers ---

const ru = (n: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Дни — в UTC: дневные свечи Binance режутся по 00:00 UTC, по местному
// времени день начала мог бы съехать на соседний
const dayUtc = (ms: number, withYear: boolean) =>
    new Date(ms).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        ...(withYear ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
    });

// --- component ---

export const MarketRegimePanel = ({ data }: Props) => {
    const ticker = data.market.split('/')[0];
    return (
        <Container>
            <Header>
                <SectionTitle>Режим рынка</SectionTitle>
                <Source>{ticker} · Binance · дневные свечи</Source>
            </Header>

            <Main>
                <Label>{REGIME_LABELS[data.regime]}</Label>
                <Since>
                    с <Mono>{dayUtc(data.since, true)}</Mono> · {data.days} дн.
                </Since>
            </Main>

            <Line>
                Сила движения ADX <Mono>{ru(data.adx)}</Mono> · тренд — от {data.threshold}
            </Line>
            <Line>
                +DI <Mono>{ru(data.pdi)}</Mono> · −DI <Mono>{ru(data.mdi)}</Mono>
            </Line>
            <Closed>
                день закрыт <Mono>{dayUtc(data.closedAt, false)}</Mono> (UTC)
            </Closed>

            <Divider />
            {/* Оговорка — фиксированный текст: замер TASK-0011.1
                (docs/RESEARCH.md, «Режим рынка») */}
            <Note>
                Режим описывает прошедшие дни и запаздывает: смену видно, когда движение уже идёт,
                резкий обвал — после того, как случился, а рост рывками может не попасть в тренд
                вовсе. Ярлык может смениться через 1–2 дня. Не прогноз и не указание к сделке.
            </Note>
        </Container>
    );
};

// Заготовка на время загрузки (TASK-0005): та же форма
export const MarketRegimePanelSkeleton = () => (
    <Container aria-busy="true" aria-label="Режим рынка загружается">
        <Header>
            <Skeleton $w="100px" $h="12px" />
            <Skeleton $w="160px" $h="10px" />
        </Header>
        <Main>
            <Skeleton $w="150px" $h="22px" />
            <Skeleton $w="120px" $h="12px" />
        </Main>
        <Skeleton $w="220px" $h="12px" />
        <Gap />
        <Skeleton $w="160px" $h="12px" />
        <Divider />
        <Skeleton $w="100%" $h="12px" />
    </Container>
);

// --- styled --- (как CoinFieldsPanel)

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

// caption-uppercase системы (DESIGN.md «Typography»)
const SectionTitle = styled.div`
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${({ theme }) => theme.colors.muted};
`;

const Source = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.muted};
`;

const Main = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 8px;
`;

// Не жёлтый: четыре места primary заняты (frontend/CLAUDE.md, «Дизайн»)
const Label = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xl};
    font-weight: 600;
    color: ${({ theme }) => theme.colors.ink};
`;

const Since = styled.div`
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.bodyStrong};
`;

const Line = styled.div`
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.body};
    line-height: 1.6;
`;

const Mono = styled.span`
    font-family: ${({ theme }) => theme.font.mono};
    color: ${({ theme }) => theme.colors.bodyStrong};
`;

const Closed = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.muted};
    margin-top: 4px;
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

const Gap = styled.div`
    height: 6px;
`;
