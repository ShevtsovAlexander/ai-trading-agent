import { api } from './trading';

export interface NewsItem {
    id: string;
    title: string;
    link: string;
    source: string;
    category: string | null;
    imageUrl: string | null;
    publishedAt: string;
}

export const getNews = async (): Promise<NewsItem[]> => {
    const { data } = await api.get<NewsItem[]>('/news');
    return data;
};

export interface Digest {
    summary: string;
    generatedAt: string;
    itemCount: number;
}

export const getDigest = async (): Promise<Digest | null> => {
    const { data } = await api.get<Digest | null>('/news/digest');
    return data;
};
