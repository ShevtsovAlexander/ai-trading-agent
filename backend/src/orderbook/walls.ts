import { Book, BookExchange } from './orderbook.types';

// Ступень цены: заявки обеих бирж с ценой в [from, to) — одна полоса.
// Ступень, внутри которой mid, обрезана по mid: у покупок to = mid, у
// продаж from = mid — полоса не заходит за цену (решение человека по
// критику T2, вариант А)
export interface Wall {
  from: number; // нижняя граница, USDT: граница ступени или mid (продажи)
  to: number; // верхняя: from + step или mid (покупки)
  coin: number; // объём, монеты
  usdt: number; // Σ цена × объём уровней ступени (точно, не coin × середина)
  byExchange: Partial<Record<BookExchange, number>>; // монеты; нет заявок — нет ключа
}

export interface Walls {
  mid: number;
  coverage: { bid: number; ask: number }; // общий край охвата, цены
  bids: Wall[]; // ≤ n, по убыванию usdt
  asks: Wall[];
}

// Цены и шаги — целыми в единицах 1e-8 (точность цены Binance): деление
// дробных даёт 94.15 / 0.05 = 1882.999…, и уровень ушёл бы в соседнюю
// ступень (план TASK-0009, «Сборка», п. 4). До 1e5 USDT × 1e8 < 2^53
const SCALE = 1e8;
const units = (x: number) => Math.round(x * SCALE);

// Стены двух стаканов (план TASK-0009, «Сборка»):
// 1. mid — середина лучших цен Binance (свечи — Binance), иначе OKX.
// 2. Край стороны у биржи — её самая дальняя цена, если сторона не отдана
//    целиком; общий — ближайший к mid. Все стороны целые — самый дальний.
//    Дальше края одной биржи сумма тихо стала бы одной биржей (trade-off 2).
// 3. Покупки < mid, продажи > mid, не дальше края (trade-off 3: у бирж
//    разная цена, иначе продажа OKX встала бы ниже свечи Binance).
// 4. Ступень floor(цена / step); ступень, которую край режет, отброшена;
//    ступень с mid внутри обрезана по mid.
// 5. Сумма монет, Σ цена × объём, разбивка; по usdt, при равенстве — ближе
//    к mid; первые n.
export function buildWalls(input: {
  binance: Book | null;
  okx: Book | null;
  step: number;
  n: number;
}): Walls {
  const books = (['binance', 'okx'] as const).flatMap((exchange) => {
    const book = input[exchange];
    return book ? [{ exchange, book }] : [];
  });
  if (books.length === 0) throw new Error('buildWalls: нет ни одного стакана');

  const first = books[0].book;
  const mid = (first.bids[0][0] + first.asks[0][0]) / 2;
  const midU = units(mid);
  const stepU = units(input.step);

  const edge = (kind: 'bid' | 'ask'): number => {
    const ends = books.map(({ book }) => ({
      price: kind === 'bid' ? book.bids.at(-1)![0] : book.asks.at(-1)![0],
      full: book.full[kind],
    }));
    const cut = ends.filter((e) => !e.full).map((e) => e.price);
    const all = ends.map((e) => e.price);
    if (kind === 'bid') return cut.length ? Math.max(...cut) : Math.min(...all);
    return cut.length ? Math.min(...cut) : Math.max(...all);
  };
  const coverage = { bid: edge('bid'), ask: edge('ask') };

  const collect = (kind: 'bid' | 'ask'): Wall[] => {
    const edgeU = units(coverage[kind]);
    const buckets = new Map<number, Wall>();
    for (const { exchange, book } of books) {
      for (const [price, qty] of kind === 'bid' ? book.bids : book.asks) {
        const p = units(price);
        const inside =
          kind === 'bid' ? p < midU && p >= edgeU : p > midU && p <= edgeU;
        if (!inside) continue;
        const idx = (p - (p % stepU)) / stepU;
        let w = buckets.get(idx);
        if (!w) {
          const fromU = idx * stepU;
          const toU = fromU + stepU;
          w = {
            from: (kind === 'ask' ? Math.max(fromU, midU) : fromU) / SCALE,
            to: (kind === 'bid' ? Math.min(toU, midU) : toU) / SCALE,
            coin: 0,
            usdt: 0,
            byExchange: {},
          };
          buckets.set(idx, w);
        }
        w.coin += qty;
        w.usdt += price * qty;
        w.byExchange[exchange] = (w.byExchange[exchange] ?? 0) + qty;
      }
    }
    const whole = [...buckets.entries()].filter(([idx]) =>
      kind === 'bid' ? idx * stepU >= edgeU : (idx + 1) * stepU <= edgeU,
    );
    whole.sort(
      ([ia, a], [ib, b]) =>
        b.usdt - a.usdt || (kind === 'bid' ? ib - ia : ia - ib),
    );
    return whole.slice(0, input.n).map(([, w]) => w);
  };

  return { mid, coverage, bids: collect('bid'), asks: collect('ask') };
}
