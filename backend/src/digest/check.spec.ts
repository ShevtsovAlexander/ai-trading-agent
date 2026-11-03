/**
 * Проверка ответа модели (TASK-0012): известные ответы на подставных текстах.
 */
import { checkSummary, numbersIn } from './check';

// Допустимый текст — строки фактов и тексты заголовков, как отдаёт сервис
// (без нумерации «1.» и инструкции промпта)
const PROMPT = `BTC: цена 77\u00a0732,00 USDT; за 24 ч +0,30 %; объём за 24 ч 1,08 млрд USDT — 0,96 от среднего суточного за 30 дней; режим по дневным свечам: боковик, 17 дн.
ETH: цена 2\u00a0297,96 USDT; за 24 ч -1,27 %; объём за 24 ч 366 млн USDT — 0,62 от среднего суточного за 30 дней; режим по дневным свечам: тренд вниз, 26 дн.
Притоки в спотовые ETF на биткоин достигли $250 млн за неделю`;
const CHANGES = [0.3, -1.27];

describe('numbersIn — нормализация', () => {
  it('разряды через пробелы, запятая и точка, незначащие нули', () => {
    expect(
      numbersIn('77\u00a0732,00 и 1 234,5 и 2\u202f297.96 и 0,30'),
    ).toEqual([77732, 1234.5, 2297.96, 0.3]);
  });
});

describe('checkSummary — числа только из промпта', () => {
  it('числа из фактов в другом написании — ок', () => {
    expect(
      checkSummary(
        'BTC почти не изменился за 24 ч (+0,3 %), цена 77 732 USDT, объём 0,96 от обычного за 30 дней; режим — боковик 17 дн.',
        PROMPT,
      ),
    ).toEqual({ ok: true });
  });

  it('число из заголовка — ок', () => {
    expect(
      checkSummary('Притоки в ETF на биткоин — $250 млн за неделю.', PROMPT),
    ).toEqual({ ok: true });
  });

  it('выдуманное число — отказ с этим числом', () => {
    expect(checkSummary('BTC вырос на 3,5 % за сутки.', PROMPT)).toEqual({
      ok: false,
      reason: 'числа не из данных: 3.5',
    });
  });

  it('округлённое моделью число — тоже отказ (строго)', () => {
    expect(checkSummary('Цена BTC около 78 000 USDT.', PROMPT)).toEqual({
      ok: false,
      reason: 'числа не из данных: 78000',
    });
  });

  it('дата, которой нет в данных, — отказ', () => {
    expect(checkSummary('На 3 ноября рынок спокоен.', PROMPT).ok).toBe(false);
  });

  it('текст без чисел — ок', () => {
    expect(
      checkSummary('Рынок спокоен, новостей о регуляторах нет.', PROMPT),
    ).toEqual({
      ok: true,
    });
  });
});

describe('checkSummary — слова-указания', () => {
  const bad = [
    'Сейчас стоит купить BTC.',
    'Продавайте ETH.',
    'Рекомендуем подождать.',
    'Купите на откате.',
    'Лучше войти позже.',
    'Не время продать.',
  ];
  bad.forEach((t) =>
    it(`«${t}» — отказ`, () => {
      const r = checkSummary(t, PROMPT);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason.startsWith('слово-указание')).toBe(
        true,
      );
    }),
  );

  it('слово-указание внутри другого слова — не указание (граница слова)', () => {
    // «прокупить» / «перепродать» — не повелительное «купить»/«продать»
    expect(
      checkSummary('Индекс «Перепродать» и «прокупить» — термины.', PROMPT),
    ).toEqual({ ok: true });
    expect(checkSummary('Покупайка вошла в топ.', PROMPT)).toEqual({
      ok: true,
    });
  });

  const fine = [
    'Давление продаж ослабло.',
    'Покупатели активнее продавцов.',
    'Объём покупок вырос.',
    'Вход капитала в ETF продолжился.',
  ];
  fine.forEach((t) =>
    it(`«${t}» — описание, ок`, () => {
      expect(checkSummary(t, PROMPT)).toEqual({ ok: true });
    }),
  );
});

describe('checkSummary — только числа данных, без нумерации и инструкции', () => {
  it('небольшое целое, которого нет в данных («в 2 раза», «за 5 дней»), — отказ', () => {
    expect(checkSummary('Объём вырос в 2 раза.', PROMPT, CHANGES).ok).toBe(
      false,
    );
    expect(checkSummary('За 5 дней рынок спокоен.', PROMPT, CHANGES).ok).toBe(
      false,
    );
  });
});

describe('checkSummary — направление изменения', () => {
  it('рост и падение со знаком факта — ок', () => {
    expect(
      checkSummary('BTC вырос на 0,30 %, ETH упал на 1,27 %.', PROMPT, CHANGES),
    ).toEqual({ ok: true });
    expect(checkSummary('BTC +0,3 %, ETH -1,27 %.', PROMPT, CHANGES)).toEqual({
      ok: true,
    });
  });

  it('перевёрнутый знак словом — отказ', () => {
    expect(checkSummary('ETH вырос на 1,27 %.', PROMPT, CHANGES)).toEqual({
      ok: false,
      reason: 'направление: рост на 1.27 %: знак не тот',
    });
    expect(checkSummary('BTC просел на 0,30 %.', PROMPT, CHANGES).ok).toBe(
      false,
    );
    expect(
      checkSummary('Цена ETH снизилась почти на 0,3 %.', PROMPT, CHANGES).ok,
    ).toBe(false);
  });

  it('перевёрнутый знак числом (+ / \u2212 / -) — отказ', () => {
    expect(checkSummary('ETH +1,27 % за сутки.', PROMPT, CHANGES).ok).toBe(
      false,
    );
    expect(checkSummary('BTC \u22120,30 %.', PROMPT, CHANGES).ok).toBe(false);
  });

  it('рост не изменения (объём, цена) — не проверяется направлением', () => {
    expect(
      checkSummary('Объём BTC вырос до 1,08 млрд USDT.', PROMPT, CHANGES),
    ).toEqual({ ok: true });
  });
});

describe('checkSummary — направление: фразы критика T4–T5', () => {
  const HEAD = 'Биткоин вырос на 5 % за неделю, пишут аналитики';
  const ALLOWED = PROMPT + '\n' + HEAD;
  const c = (t: string) => checkSummary(t, ALLOWED, CHANGES, HEAD);

  it('тикер или «за 24 ч» между словом и числом — знак всё равно проверен', () => {
    expect(c('Падение BTC на 0,30 %.').ok).toBe(false);
    expect(c('BTC снизился за 24 ч на 0,30 %.').ok).toBe(false);
    expect(c('Рост ETH на 1,27 % за сутки.').ok).toBe(false);
    expect(c('Падение ETH на 1,27 %.')).toEqual({ ok: true });
    expect(c('ETH снизился за 24 ч на 1,27 %.')).toEqual({ ok: true });
  });

  it('процент после «рост/падение», не изменение и не из заголовка, — отказ', () => {
    expect(c('BTC вырос на 17 %.')).toEqual({
      ok: false,
      reason: 'направление: рост на 17 %: не изменение из фактов',
    });
    expect(c('SOL упал на 30 %.').ok).toBe(false);
  });

  it('процент из заголовка пересказывать можно', () => {
    expect(c('Биткоин вырос на 5 % за неделю, по данным заголовков.')).toEqual({
      ok: true,
    });
  });

  it('основа — с начала слова; число без % после основы не проверяется направлением', () => {
    expect(c('Рынок просто стоял, ETH -1,27 %.')).toEqual({ ok: true });
    expect(c('Объём ETH снизился до 0,62 от среднего за 30 дней.')).toEqual({
      ok: true,
    });
  });

  it('направление проверяется в пределах предложения', () => {
    // «вырос» — про объём в первом предложении, процент — во втором
    expect(c('Объём BTC вырос до 1,08 млрд USDT. ETH -1,27 %.')).toEqual({
      ok: true,
    });
  });
});

describe('checkSummary — направление: ближайшее слово перед числом (критик T6)', () => {
  // BTC +0,30; ETH −1,27 (CHANGES); объём ETH 0,62, BTC 0,96
  const c = (t: string) => checkSummary(t, PROMPT, CHANGES);

  it('слово направления без своего числа не забирает чужой процент', () => {
    expect(c('На фоне падения рынка BTC всё же вырос на 0,30 %.')).toEqual({
      ok: true,
    });
    expect(
      c('ETH растёт по объёму, тогда как цена ETH снижается на 1,27 %.'),
    ).toEqual({
      ok: true,
    });
    expect(
      c('Объём ETH вырос до 0,62 от среднего, цена упала на 1,27 %.'),
    ).toEqual({
      ok: true,
    });
    expect(
      c('Объём BTC упал до 0,96 от среднего, а цена выросла на 0,30 %.'),
    ).toEqual({
      ok: true,
    });
  });

  it('перевёрнутый знак у ближайшего слова — по-прежнему отказ', () => {
    expect(c('На фоне роста рынка BTC упал на 0,30 %.').ok).toBe(false);
    expect(
      c('Объём ETH упал до 0,62 от среднего, цена выросла на 1,27 %.').ok,
    ).toBe(false);
  });

  it('десятичная точка не режет предложение', () => {
    expect(c('Цена ETH 2297.96, рост на 1.27 %.').ok).toBe(false);
    expect(c('ETH подешевел на 1.27 %. Далее BTC прибавил 0,30 %.')).toEqual({
      ok: true,
    });
  });
});
