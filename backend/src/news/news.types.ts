export interface NewsItem {
  id: string; // guid из фида — стабильный ключ для React
  title: string;
  link: string;
  source: string; // 'Cointelegraph' | 'Coindesk'
  category: string | null;
  imageUrl: string | null;
  publishedAt: string; // ISO
}
