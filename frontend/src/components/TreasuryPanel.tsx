import styled from 'styled-components';
import { Skeleton } from './Skeleton';
import { InfoHint } from './InfoHint';
import { BLOCK_HINT_LABEL, BLOCK_HINTS, HintRow, HintSlot } from './blockHints';
import type { Treasury } from '../types/treasury';

interface Props {
    data: Treasury;
}

// --- helpers ---

const ru = (n: number, digits: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const usdShort = (usd: number) =>
    usd >= 1e9 ? `$${ru(usd / 1e9, 2)} млрд` : `$${ru(usd / 1e6, 0)} млн`;

// Монеты: ≥ 1 млн — «1,31 млн BTC», иначе целым с разрядами
const coins = (n: number, ticker: string) =>
    n >= 1e6 ? `${ru(n / 1e6, 2)} млн ${ticker}` : `${ru(n, 0)} ${ticker}`;

// 1 компания, 2–4 компании, 5–20 компаний, 21 компания…
const companiesWord = (n: number) => {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return 'компания';
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'компании';
    return 'компаний';
};

const time = (ms: number) =>
    new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// --- component ---

export const TreasuryPanel = ({ data }: Props) => {
    const ticker = data.market.split('/')[0];
    return (
        <Container>
            <Header>
                <SectionTitle>
                    Компании-держатели
                    <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.treasury}</InfoHint></HintSlot>
                </SectionTitle>
                <Source>
                    {ticker} · CoinGecko · получено {time(data.fetchedAt)}
                </Source>
            </Header>

            <Pair>
                <div>
                    <StatLabel>Держат публичные компании</StatLabel>
                    <Value>{coins(data.totalHoldings, ticker)}</Value>
                </div>
                <div>
                    <StatLabel>Стоимость</StatLabel>
                    <Value>{usdShort(data.totalValueUsd)}</Value>
                </div>
            </Pair>
            <Line>
                {data.shareOfCirculatingPct === null
                    ? `${data.companies} ${companiesWord(data.companies)} · доля от монет в обращении — нет данных`
                    : `${data.companies} ${companiesWord(data.companies)} · ${ru(data.shareOfCirculatingPct, 2)} % монет в обращении`}
            </Line>

            <Top>
                {data.top.map((c) => (
                    <Row key={`${c.symbol}-${c.name}`}>
                        <Name>
                            {c.name} <Muted>{c.symbol}</Muted>
                        </Name>
                        <Mono>{coins(c.holdings, ticker)}</Mono>
                        <Mono>{usdShort(c.valueUsd)}</Mono>
                    </Row>
                ))}
            </Top>

            <Divider />
            {/* Оговорка — фиксированный текст (план TASK-0013) */}
            <Note>
                Только публичные компании по сводке CoinGecko из их отчётов — держания запаздывают на
                дни и недели, доля считается от монет в обращении сейчас. Не ETF и не фонды, не
                потоки денег: сколько держат, а не сколько покупают. Не указание к сделке.
            </Note>
        </Container>
    );
};

// Заготовка на время загрузки (TASK-0005): та же форма
export const TreasuryPanelSkeleton = () => (
    <Container aria-busy="true" aria-label="Компании-держатели загружаются">
        <Header>
            <HintRow>
                <Skeleton $w="150px" $h="12px" />
                <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.treasury}</InfoHint></HintSlot>
            </HintRow>
            <Skeleton $w="180px" $h="10px" />
        </Header>
        <Pair>
            {[0, 1].map((i) => (
                <div key={i}>
                    <Skeleton $w="120px" $h="10px" />
                    <Gap />
                    <Skeleton $w="140px" $h="22px" />
                </div>
            ))}
        </Pair>
        {[0, 1, 2, 3, 4].map((i) => (
            <div key={i}>
                <Skeleton $w="100%" $h="12px" />
                <Gap />
            </div>
        ))}
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
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${({ theme }) => theme.colors.muted};
`;

const Source = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.muted};
`;

const Pair = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 8px;
`;

const StatLabel = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.muted};
    margin-bottom: 2px;
`;

// Не жёлтый: четыре места primary заняты (frontend/CLAUDE.md, «Дизайн»)
const Value = styled.div`
    font-family: ${({ theme }) => theme.font.mono};
    font-size: ${({ theme }) => theme.fontSize.xl};
    font-weight: 600;
    color: ${({ theme }) => theme.colors.ink};
`;

const Line = styled.div`
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.body};
    margin-bottom: 10px;
`;

const Top = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
`;

const Row = styled.div`
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 12px;
    font-size: ${({ theme }) => theme.fontSize.sm};
    color: ${({ theme }) => theme.colors.body};
`;

const Name = styled.span`
    color: ${({ theme }) => theme.colors.bodyStrong};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`;

const Muted = styled.span`
    color: ${({ theme }) => theme.colors.muted};
`;

const Mono = styled.span`
    font-family: ${({ theme }) => theme.font.mono};
    color: ${({ theme }) => theme.colors.bodyStrong};
    text-align: right;
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
