import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { getNews, getDigest, type NewsItem, type Digest, type MarketFact } from '../api/news';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import { Skeleton } from './Skeleton';
import { InfoHint } from './InfoHint';
import { BLOCK_HINT_LABEL, BLOCK_HINTS, HintSlot } from './blockHints';

// Категории, которые метим как регуляторно-значимые (визуальный акцент)
const SIGNAL_CATEGORIES = new Set(['policy', 'regulation', 'finance']);

export const NewsPanel = () => {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [digest, setDigest] = useState<Digest | null>(null);
    const [loading, setLoading] = useState(true);
    // Скелетон — через 300 мс, как на «Рынке» (TASK-0005)
    const skeleton = useDelayedFlag(loading, 300);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [n, d] = await Promise.all([getNews(), getDigest()]);
                if (!cancelled) {
                    setNews(n);
                    setDigest(d);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        const id = setInterval(load, 60 * 60 * 1000); // час — совпадает с backend TTL
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    if (loading) {
        return (
            <Container aria-busy="true">
                <Title>
                    Лента новостей
                    <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.news}</InfoHint></HintSlot>
                </Title>
                {skeleton && (
                    <>
                        {/* Дайджест — одной плашкой: внутри DigestCard плашки
                            сливались бы с его фоном того же тона */}
                        <SkeletonDigest>
                            <Skeleton $h="84px" />
                        </SkeletonDigest>
                        <List>
                            {Array.from({ length: 5 }, (_, i) => (
                                <SkeletonCard key={i}>
                                    <Skeleton $w="64px" $h="64px" />
                                    <Content>
                                        <Skeleton $w="420px" $h="14px" />
                                        <Skeleton $w="160px" $h="10px" />
                                    </Content>
                                </SkeletonCard>
                            ))}
                        </List>
                    </>
                )}
            </Container>
        );
    }

    return (
        <Container>
            <Title>
                Лента новостей · {news.length}
                <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.news}</InfoHint></HintSlot>
            </Title>

            {digest && (
                <DigestCard>
                    <DigestHead>
                        <DigestLabel>
                            AI-свод
                            <HintSlot><InfoHint label={BLOCK_HINT_LABEL}>{BLOCK_HINTS.digest}</InfoHint></HintSlot>
                        </DigestLabel>
                        <DigestMeta>
                            {digest.itemCount > 0 ? `${digest.itemCount} новостей` : 'без новостей'} ·{' '}
                            {formatTime(digest.generatedAt)}
                        </DigestMeta>
                    </DigestHead>
                    {digest.summary !== null ? (
                        <DigestText>{digest.summary}</DigestText>
                    ) : (
                        <NoSummary>
                            Свод не сгенерирован: модель недоступна или её ответ не прошёл проверку
                            чисел. Ниже — только числа.
                        </NoSummary>
                    )}
                    {/* Факты рынка — посчитаны кодом, текст модели строится по ним
                        (TASK-0012): человек сверяет текст с числами */}
                    {(digest.market.facts.length > 0 || digest.market.failed.length > 0) && (
                        <Facts>
                            {digest.market.facts.map((f) => (
                                <FactRow key={f.coinId}>
                                    <Ticker>{f.market.split('/')[0]}</Ticker>
                                    <FactMono>{ru(f.price, 2)} USDT</FactMono>
                                    <Change $dir={Math.sign(f.change24hPct)}>
                                        {f.change24hPct > 0 ? '+' : ''}
                                        {ru(f.change24hPct, 2)} % за 24 ч
                                    </Change>
                                    <span>
                                        объём <FactMono>{usdShort(f.volume24hUsd)}</FactMono> ·{' '}
                                        <FactMono>{ru(f.volumeRatio30d, 2)}</FactMono> к среднему за 30 дн.
                                    </span>
                                    <span>{regimeText(f)}</span>
                                </FactRow>
                            ))}
                            {digest.market.failed.map((id) => (
                                <FactRow key={id}>
                                    <Ticker>{TICKER[id] ?? id}</Ticker>
                                    <Failed>нет данных Binance</Failed>
                                </FactRow>
                            ))}
                        </Facts>
                    )}
                    <DigestNote>
                        {digest.market.facts.length > 0 &&
                            `Числа посчитаны кодом по часовым свечам Binance, час закрыт ${clock(
                                Math.max(...digest.market.facts.map((f) => f.at)),
                            )}. `}
                        Текст пишет модель по этим числам и заголовкам и может ошибаться в словах —
                        сверяйте с числами. Не прогноз и не указание к сделке.
                    </DigestNote>
                </DigestCard>
            )}

            <List>
                {news.map((item) => (
                    <Card
                        key={item.id}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {item.imageUrl && <Thumb src={item.imageUrl} alt="" loading="lazy" />}
                        <Content>
                            <Headline>{item.title}</Headline>
                            <Meta>
                                <Source>
                                    {item.source}
                                </Source>
                                {item.category &&
                                    (SIGNAL_CATEGORIES.has(item.category.toLowerCase()) ? (
                                        <SignalTag>{item.category}</SignalTag>
                                    ) : (
                                        <Category>{item.category}</Category>
                                    ))}
                                <Time>{formatTime(item.publishedAt)}</Time>
                            </Meta>
                        </Content>
                    </Card>
                ))}
            </List>
        </Container>
    );
};

const ru = (n: number, digits: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const usdShort = (usd: number) =>
    usd >= 1e9 ? `${ru(usd / 1e9, 2)} млрд USDT` : `${ru(usd / 1e6, 0)} млн USDT`;

const REGIME_RU = { up: 'тренд вверх', down: 'тренд вниз', range: 'боковик' } as const;
const regimeText = (f: MarketFact) =>
    f.regime === null ? 'режим — нет данных' : `${REGIME_RU[f.regime]} ${f.regimeDays} дн.`;

const TICKER: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL' };

// Время закрытия часа — местное, как «обновлено» у карточки «Монета»
const clock = (ms: number) =>
    new Date(ms + 1).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const formatTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return `${Math.floor(diff / 60_000)} мин назад`;
    if (h < 24) return `${h} ч назад`;
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

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
  margin-bottom: 12px;
`;

// Без градиента и теней: глубина — контрастом поверхностей (DESIGN.md «Elevation»)
const DigestCard = styled.div`
  background: ${({ theme }) => theme.colors.surfaceElevated};
  border: 1px solid ${({ theme }) => theme.colors.hairline};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 14px;
  margin-bottom: 12px;
`;

const DigestHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const DigestLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${({ theme }) => theme.colors.primary};
`;

const DigestMeta = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.muted};
`;

const DigestText = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.body};
  line-height: 1.55;
  white-space: pre-line; /* LLM может вернуть переносы по темам */
`;

const NoSummary = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.55;
`;

const Facts = styled.div`
  border-top: 1px solid ${({ theme }) => theme.colors.hairline};
  margin-top: 10px;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FactRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.body};
`;

const Ticker = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.ink};
  min-width: 32px;
`;

const FactMono = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  color: ${({ theme }) => theme.colors.bodyStrong};
`;

// Рост/падение — up/down, как свечи (frontend/CLAUDE.md, «Дизайн»)
const Change = styled.span<{ $dir: number }>`
  font-family: ${({ theme }) => theme.font.mono};
  color: ${({ theme, $dir }) =>
    $dir > 0 ? theme.colors.up : $dir < 0 ? theme.colors.down : theme.colors.bodyStrong};
`;

const Failed = styled.span`
  color: ${({ theme }) => theme.colors.warning};
`;

const DigestNote = styled.p`
  margin-top: 8px;
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
`;

const SkeletonDigest = styled.div`
  margin-bottom: 12px;
`;

// Строка ленты на время загрузки — те же отступы, что у Card
const SkeletonCard = styled.div`
  display: flex;
  gap: 12px;
  padding: 10px;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 600px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.hairlineStrong};
    border-radius: 99px;
  }
`;

const Card = styled.a`
  display: flex;
  gap: 12px;
  padding: 10px;
  border-radius: ${({ theme }) => theme.radius.md};
  text-decoration: none;
  transition: background 0.15s;

  &:hover { background: ${({ theme }) => theme.colors.surfaceElevated}; }
`;

const Thumb = styled.img`
  width: 64px;
  height: 64px;
  border-radius: ${({ theme }) => theme.radius.sm};
  object-fit: cover;
  flex-shrink: 0;
`;

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const Headline = styled.div`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.bodyStrong};
  line-height: 1.4;
`;

const Meta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

// Источник — монохромом, без второго брендового цвета (DESIGN.md «Don't»)
const Source = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const Category = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.mutedSoft};
`;

const SignalTag = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.warning};
  background: ${({ theme }) => `${theme.colors.warning}1a`};
  padding: 1px 6px;
  border-radius: ${({ theme }) => theme.radius.xs};
`;

const Time = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.mutedSoft};
  margin-left: auto;
`;
