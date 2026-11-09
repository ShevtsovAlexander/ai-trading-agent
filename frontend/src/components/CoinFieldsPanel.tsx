import styled from 'styled-components';
import { Skeleton } from './Skeleton';
import { InfoHint } from './InfoHint';
import { BLOCK_HINT_LABEL, BLOCK_HINTS, HintRow, HintSlot } from './blockHints';
import type { CoinFields } from '../types/coin';

interface Props {
    data: CoinFields;
}

// --- helpers ---

const ru = (n: number, digits: number) =>
    n.toLocaleString('ru-RU', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });

// Деньги — $ и разряд словом: капитализации BTC/ETH/SOL — от десятков
// млрд до трлн (research TASK-0010)
const usdShort = (usd: number) =>
    usd >= 1e12
        ? `$${ru(usd / 1e12, 2)} трлн`
        : usd >= 1e9
          ? `$${ru(usd / 1e9, 2)} млрд`
          : `$${ru(usd / 1e6, 2)} млн`;

// Монеты — разряд словом и тикер: 20,11 млн BTC
const coinsShort = (n: number, ticker: string) =>
    n >= 1e9
        ? `${ru(n / 1e9, 2)} млрд ${ticker}`
        : n >= 1e6
          ? `${ru(n / 1e6, 2)} млн ${ticker}`
          : `${ru(n, 0)} ${ticker}`;

// Доля в обращении от максимума — одним знаком; считается только при
// заданном максимуме (PRD, критерий 2)
const sharePct = (circulating: number, max: number) =>
    `${ru((circulating / max) * 100, 1)} %`;

const time = (ms: number) =>
    new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// --- component ---

export const CoinFieldsPanel = ({ data }: Props) => {
    const ticker = data.market.split('/')[0];
    return (
        <Container>
            <Header>
                <SectionTitle>
                    Монета
                    <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.coin}</InfoHint></HintSlot>
                </SectionTitle>
                <Source>
                    {ticker} · CoinGecko · обновлено {time(data.updatedAt)}
                </Source>
            </Header>

            <Pair>
                <div>
                    <StatLabel>Капитализация</StatLabel>
                    <Value>{usdShort(data.marketCapUsd)}</Value>
                </div>
                <div>
                    <StatLabel>FDV · полная оценка</StatLabel>
                    {data.fdvUsd === null ? (
                        <Muted>нет данных</Muted>
                    ) : (
                        <Value>{usdShort(data.fdvUsd)}</Value>
                    )}
                </div>
            </Pair>

            <Supply>
                <div>
                    <StatLabel>В обращении</StatLabel>
                    <Small>{coinsShort(data.circulating, ticker)}</Small>
                </div>
                <div>
                    <StatLabel>Всего выпущено</StatLabel>
                    {data.total === null ? (
                        <Muted>нет данных</Muted>
                    ) : (
                        <Small>{coinsShort(data.total, ticker)}</Small>
                    )}
                </div>
                <div>
                    <StatLabel>Максимум</StatLabel>
                    {data.max === null ? (
                        <Small>лимита нет</Small>
                    ) : (
                        <Small>{coinsShort(data.max, ticker)}</Small>
                    )}
                </div>
            </Supply>
            <Line>
                {/* null у CoinGecko — поле пусто, не «правила сети»: говорим
                    только то, что знают данные (критик T5) */}
                {data.max === null
                    ? 'Максимум у CoinGecko не задан — доли от максимума нет'
                    : `В обращении ${sharePct(data.circulating, data.max)} от максимума`}
            </Line>

            <Divider />
            {/* Оговорка — фиксированный текст (план TASK-0010, «Показ») */}
            <Note>
                Оценка CoinGecko по средней цене бирж — может не совпадать с ценой Binance на
                графике. FDV у CoinGecko — цена × всего выпущено, не × максимум. Это масштаб
                монеты, а не указание к сделке.
            </Note>
        </Container>
    );
};

// Заготовка на время загрузки (TASK-0005): та же форма
export const CoinFieldsPanelSkeleton = () => (
    <Container aria-busy="true" aria-label="Поля монеты загружаются">
        <Header>
            <HintRow>
                <Skeleton $w="70px" $h="12px" />
                <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.coin}</InfoHint></HintSlot>
            </HintRow>
            <Skeleton $w="180px" $h="10px" />
        </Header>
        <Pair>
            {[0, 1].map((i) => (
                <div key={i}>
                    <Skeleton $w="100px" $h="10px" />
                    <Gap />
                    <Skeleton $w="140px" $h="22px" />
                </div>
            ))}
        </Pair>
        <Supply>
            {[0, 1, 2].map((i) => (
                <div key={i}>
                    <Skeleton $w="80px" $h="10px" />
                    <Gap />
                    <Skeleton $w="110px" $h="14px" />
                </div>
            ))}
        </Supply>
        <Skeleton $w="240px" $h="12px" />
        <Divider />
        <Skeleton $w="100%" $h="12px" />
    </Container>
);

// --- styled --- (как DerivativesPanel)

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
    margin-bottom: 12px;
`;

const Supply = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
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

const Small = styled.div`
    font-family: ${({ theme }) => theme.font.mono};
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.bodyStrong};
`;

const Muted = styled.div`
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.muted};
`;

const Line = styled.div`
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.body};
    line-height: 1.5;
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
