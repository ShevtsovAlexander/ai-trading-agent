import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { getNews, getDigest, type NewsItem, type Digest } from '../api/news';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import { Skeleton } from './Skeleton';

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
                <Title>Лента новостей</Title>
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
            <Title>Лента новостей · {news.length}</Title>

            {digest && (
                <DigestCard>
                    <DigestHead>
                        <DigestLabel>AI-свод</DigestLabel>
                        <DigestMeta>
                            {digest.itemCount} новостей · {formatTime(digest.generatedAt)}
                        </DigestMeta>
                    </DigestHead>
                    <DigestText>{digest.summary}</DigestText>
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
