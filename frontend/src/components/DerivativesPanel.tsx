import styled from 'styled-components';
import { Skeleton } from './Skeleton';
import type {
    Derivatives,
    Exchange,
    FundingView,
    SourceError,
    Stress,
} from '../types/derivatives';

interface Props {
    data: Derivatives;
}

const EXCHANGE_LABELS: Record<Exchange, string> = {
    binance: 'Binance',
    okx: 'OKX',
    bybit: 'Bybit',
};

// --- helpers ---

// Ставка — доля за интервал; на экране в процентах с 4 знаками (шаг ставок
// Binance — 0,000001 %, нейтральная — 0,0100 %)
const ratePct = (rate: number) =>
    `${(rate * 100).toLocaleString('ru-RU', {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    })} %`;

const PERIOD = (s: Stress) => (s.periodDays === 365 ? 'за год' : `за ${s.periodDays} дн.`);

// Редко — так же далеко бывало реже чем в 5 % выплат окна (RESEARCH.md,
// funding: такие выплаты — 8–11 % истории). Порог — по показанному целому
// проценту: иначе 4,6 % («в 5 %») выделялось бы, а 5,4 % («в 5 %») нет
// (критик T7)
export const RARE_PCT = 5;
const isRare = (s: Stress | null) =>
    s?.tailPct != null && Math.round(s.tailPct) < RARE_PCT;

// «Как часто бывало так же далеко» — целым процентом (бэкенд не
// округляет); ненулевая доля меньше процента не превращается в «0 %»
const tailText = (s: Stress, side: 'ниже' | 'выше') => {
    const pct = s.tailPct!;
    const low = side === 'ниже' ? 'низкой' : 'высокой';
    const text =
        pct === 0
            ? `${PERIOD(s)} ставка ни разу не была такой ${low}`
            : `${PERIOD(s)} ставка была такой же или ${side} ${
                  pct < 1 ? 'реже чем в 1 %' : `в ${Math.round(pct)} %`
              } выплат`;
    return isRare(s) ? `${text} · редко` : text;
};

// Главная строка — от нормы Binance 0,01 %, не «от обычного для монеты»:
// хвост рядом говорит, обычно ли это (критик T7). Ставка — перевес (кто
// готов доплачивать), а не число лонгов и шортов: их всегда поровну.
// Ниже нормы, но выше нуля — фьючерс дешевле спота: лёгкий перевес в
// сторону падения (docs/RESEARCH.md, funding)
const stressText = (s: Stress | null): { main: string; tail: string | null } => {
    if (!s) return { main: 'перевес не оценить — история ставок не загрузилась', tail: null };
    switch (s.state) {
        case 'neutral':
            return { main: 'на норме — перекоса по ставке не видно', tail: null };
        case 'unknown':
            return {
                main: `биржа сменила интервал выплат (${s.intervalHours} ч) — сравнить с нормой нельзя`,
                tail: null,
            };
        case 'above':
            return { main: 'выше нормы — перевес в сторону роста', tail: tailText(s, 'выше') };
        case 'below':
            return { main: 'ниже нормы — лёгкий перевес в сторону падения', tail: tailText(s, 'ниже') };
        case 'negative':
            return { main: 'ниже нуля — перевес в сторону падения', tail: tailText(s, 'ниже') };
    }
};

// Время выплаты — местное; «через» — от момента снимка Binance (at), а не
// от часов браузера: рендер без Date.now(), отставание — до одного опроса
const payout = (f: FundingView) => {
    const time = new Date(f.nextFundingTime).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
    });
    const left = Math.max(0, Math.round((f.nextFundingTime - f.at) / 60_000));
    const h = Math.floor(left / 60);
    const m = left % 60;
    return `выплата в ${time} (через ${h > 0 ? `${h} ч ` : ''}${m} мин)`;
};

const usdBn = (usd: number) =>
    `$${(usd / 1e9).toLocaleString('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} млрд`;

const isError = (f: FundingView | SourceError): f is SourceError => 'error' in f;

// --- component ---

export const DerivativesPanel = ({ data }: Props) => {
    const { funding, openInterest } = data;
    const missing = openInterest.exchanges
        .filter((e) => 'error' in e)
        .map((e) => EXCHANGE_LABELS[e.exchange]);
    const stress = isError(funding) ? null : stressText(funding.stress);
    const rare = !isError(funding) && isRare(funding.stress);

    return (
        <Container>
            <Header>
                <SectionTitle>Деривативы</SectionTitle>
                <Market>{data.market} · бессрочные фьючерсы</Market>
            </Header>

            <Columns>
                <Block>
                    <StatLabel>Ставка финансирования · Binance</StatLabel>
                    {isError(funding) ? (
                        <FieldError>{funding.error}</FieldError>
                    ) : (
                        <>
                            <Value>{ratePct(funding.rate)}</Value>
                            <Payout>{payout(funding)}</Payout>
                            <Line $strong>{stress!.main}</Line>
                            {stress!.tail && <Line $rare={rare}>{stress!.tail}</Line>}
                        </>
                    )}
                </Block>

                <Block>
                    <StatLabel>Открытые позиции</StatLabel>
                    {openInterest.totalUsd === null ? (
                        <FieldError>Ни одна биржа не ответила</FieldError>
                    ) : (
                        <>
                            <Value>{usdBn(openInterest.totalUsd)}</Value>
                            <Line>
                                Binance + OKX + Bybit — не весь рынок
                                {missing.length > 0 && (
                                    <Missing> · без {missing.join(', ')}</Missing>
                                )}
                            </Line>
                        </>
                    )}
                    <Exchanges>
                        {openInterest.exchanges.map((e) => (
                            <ExchangeItem key={e.exchange}>
                                <StatLabel>{EXCHANGE_LABELS[e.exchange]}</StatLabel>
                                {'error' in e ? (
                                    <FieldError>недоступна</FieldError>
                                ) : (
                                    <Small>{usdBn(e.usd)}</Small>
                                )}
                            </ExchangeItem>
                        ))}
                    </Exchanges>
                </Block>
            </Columns>

            <Divider />
            {/* Оговорка — фиксированный текст, не AI (план TASK-0007, trade-off 9) */}
            <Note>
                Норма ставки у Binance — 0,0100 % за 8 ч: выше — перевес в сторону роста,
                ниже — в сторону падения. Это перевес в ставках сейчас, а не прогноз цены;
                открытые позиции — сколько денег в ставках, без их направления.
            </Note>
        </Container>
    );
};

// Заготовка панели на время загрузки (TASK-0005): та же форма — заголовок,
// две колонки, строка оговорки
export const DerivativesPanelSkeleton = () => (
    <Container aria-busy="true">
        <Header>
            <Skeleton $w="100px" $h="12px" />
            <Skeleton $w="180px" $h="10px" />
        </Header>
        <Columns>
            {[0, 1].map((col) => (
                <Block key={col}>
                    <Skeleton $w="160px" $h="10px" />
                    <Gap />
                    <Skeleton $w="140px" $h="22px" />
                    <Gap />
                    <Skeleton $w="260px" $h="12px" />
                    <Gap />
                    <Skeleton $w="200px" $h="12px" />
                </Block>
            ))}
        </Columns>
        <Divider />
        <Skeleton $w="100%" $h="12px" />
    </Container>
);

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

// caption-uppercase системы (DESIGN.md «Typography»), как в карточке
const SectionTitle = styled.div`
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${({ theme }) => theme.colors.muted};
`;

const Market = styled.div`
    font-size: ${({ theme }) => theme.fontSize.xs};
    color: ${({ theme }) => theme.colors.muted};
`;

const Columns = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
`;

const Block = styled.div``;

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
    margin-bottom: 4px;
`;

// Редкое — жирным белым и словом «редко», не цветом: warning в панели уже
// значит «биржа недоступна», и по правилам дизайна он — для баннеров
// (frontend/CLAUDE.md, «Дизайн»; критик T7). Выделяется только строка
// «как часто», не строка с направлением
const Line = styled.div<{ $strong?: boolean; $rare?: boolean }>`
    font-size: ${({ theme }) => theme.fontSize.md};
    font-weight: ${({ $rare }) => ($rare ? 600 : 400)};
    color: ${({ $strong, $rare, theme }) =>
        $rare ? theme.colors.ink : $strong ? theme.colors.bodyStrong : theme.colors.body};
    line-height: 1.5;
`;
// Отдельной строкой: в строке ставки на узком экране переносилось
// посреди «через 2 ч 14 / мин»
const Payout = styled.div`
    font-size: ${({ theme }) => theme.fontSize.sm};
    color: ${({ theme }) => theme.colors.muted};
    margin-bottom: 6px;
`;
const Missing = styled.span`
    color: ${({ theme }) => theme.colors.warning};
`;

const Exchanges = styled.div`
    display: flex;
    gap: 20px;
    margin-top: 10px;
`;

const ExchangeItem = styled.div``;

const Small = styled.div`
    font-family: ${({ theme }) => theme.font.mono};
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.bodyStrong};
`;

const FieldError = styled.div`
    font-size: ${({ theme }) => theme.fontSize.md};
    color: ${({ theme }) => theme.colors.warning};
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
