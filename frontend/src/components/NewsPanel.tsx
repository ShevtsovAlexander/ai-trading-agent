import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { getNews, getDigest, type NewsItem, type Digest } from '../api/news';

const SOURCE_COLORS: Record<string, string> = {
    Cointelegraph: '#fabc2c',
    Coindesk: '#f7a600',
    Decrypt: '#a78bfa',
};

// Категории, которые метим как регуляторно-значимые (визуальный акцент)
const SIGNAL_CATEGORIES = new Set(['policy', 'regulation', 'finance']);

export const NewsPanel = () => {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [digest, setDigest] = useState<Digest | null>(null);
    const [loading, setLoading] = useState(true);

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
            <Container>
                <Title>Лента новостей</Title>
                <Muted>Загрузка…</Muted>
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
                                <Source $color={SOURCE_COLORS[item.source] ?? '#888'}>
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
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
`;

const Title = styled.div`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
`;

const DigestCard = styled.div`
  background: linear-gradient(
    135deg,
    ${({ theme }) => theme.colors.purple}18,
    ${({ theme }) => theme.colors.surfaceAlt}
  );
  border: 1px solid ${({ theme }) => theme.colors.purple}33;
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
  color: ${({ theme }) => theme.colors.purple};
`;

const DigestMeta = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
`;

const DigestText = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.55;
  white-space: pre-line; /* LLM может вернуть переносы по темам */
`;

const Muted = styled.div`
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: ${({ theme }) => theme.fontSize.md};
  padding: 24px 0;
  text-align: center;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 600px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
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

  &:hover { background: ${({ theme }) => theme.colors.surfaceAlt}; }
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
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.4;
`;

const Meta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const Source = styled.span<{ $color: string }>`
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  color: ${({ $color }) => $color};
`;

const Category = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
`;

const SignalTag = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  color: #f59e0b;
  background: #f59e0b22;
  padding: 1px 6px;
  border-radius: ${({ theme }) => theme.radius.sm};
`;

const Time = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.textMuted};
  margin-left: auto;
`;
