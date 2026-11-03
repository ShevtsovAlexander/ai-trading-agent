// Проверка ответа модели кодом (TASK-0012): модель путает и выдумывает числа
// (backend/CLAUDE.md, «Известное»), поэтому свод принимается, только если
// каждое число текста есть в данных (строки фактов + тексты заголовков — без
// нумерации и инструкции промпта: иначе «1»…«20» и «4–6» проходили бы —
// критик T1–T3), направление изменения не перевёрнуто и нет слов-указаний.
// Строго: честный пересказ «втрое» тоже отвергнется — лучше прошлый свод,
// чем выдуманное число (план TASK-0012, trade-off 2).

// Число: разряды через пробел / неразрывный / узкий неразрывный, дробная
// часть через запятую или точку. «1 234,5» → 1234.5; «0,30» = «0,3».
const NUMBER = /\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g;

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((s: string) =>
    parseFloat(s.replace(/[ \u00a0\u202f]/g, '').replace(',', '.')),
  );
}

// Слова-указания — рамка «триггеры, не команды» (VISION). Границы слова —
// не-буква: \b в JS не знает кириллицу. «Давление продаж» — описание, не
// указание: стоп-слова — повелительные и инфинитивы действий.
const DIRECTIVE =
  /(^|[^а-яёa-z])(купи(те)?|купить|покупай(те)?|прода(й|йте|ть)|продавай(те)?|рекоменд[а-яё]*|войти|входи(ть|те)|стоит (купить|продать|войти|покупать|продавать))(?=$|[^а-яёa-z])/iu;

// Направление (критики T1–T3, T4–T5, T6): каждый процент предложения
// получает направление от ближайшего перед ним слова «рост/падение» (основа с
// начала слова) — тикер, «за 24 ч» и соседняя часть предложения не мешают:
// «Объём вырос до 1,12, цена упала на 1,64 %» — 1,64 относится к «упала».
// Процент — модуль изменения какой-то монеты: знак должен совпасть; иначе он
// обязан быть из заголовка («вырос на 17 %» из дней режима — отказ).
// «+X / −X», где X — модуль изменения, — знак совпадает. Монеты не различаем:
// «ETH +1,64 %» про BTC проверка не видит.
const UP =
  '(?:вырос|выросл|рост|подрос|прибав|подня|поднима|подорож|укреп|раст[её]т)';
const DOWN =
  '(?:упал|упав|падени|падает|снизил|снижа|снижени|просел|просед|подешев|потерял|опустил|дешеве)';
const NUM = String.raw`\d+(?:[.,]\d+)?`;
// Основа — с начала слова (не «просто», не «уступал»)
const STEM = new RegExp(`(?<![а-яё])(?:(${UP})|(${DOWN}))`, 'giu');
const PCT = new RegExp(`(${NUM})\\s?%`, 'gu');
const SIGNED = new RegExp(`(^|[^\\d.,])([+\\-\\u2212])\\s?(${NUM})`, 'gu');
// Предложения — по . ! ? и пробелу после: десятичная точка («1.64») пробелом
// не отделена и предложение не режет
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);

const toNum = (s: string) => parseFloat(s.replace(',', '.'));

function directionError(
  summary: string,
  changes: number[],
  headlineNums: Set<number>,
): string | null {
  const hasSigned = (v: number) => changes.some((c) => c === v);
  const isChangeAbs = (v: number) => changes.some((c) => Math.abs(c) === v);

  for (const sentence of sentences(summary)) {
    const stems = [...sentence.matchAll(STEM)].map((m) => ({
      at: m.index ?? 0,
      sign: m[1] !== undefined ? 1 : -1,
    }));
    for (const p of sentence.matchAll(PCT)) {
      const at = p.index ?? 0;
      const stem = stems.filter((s) => s.at < at).pop(); // ближайшее слово перед числом
      if (!stem) continue;
      const v = toNum(p[1]);
      const name = stem.sign > 0 ? 'рост' : 'падение';
      if (isChangeAbs(v)) {
        if (!hasSigned(stem.sign * v)) return `${name} на ${v} %: знак не тот`;
      } else if (!headlineNums.has(v)) {
        return `${name} на ${v} %: не изменение из фактов`;
      }
    }
  }
  for (const m of summary.matchAll(SIGNED)) {
    const v = toNum(m[3]);
    const sign = m[2] === '+' ? 1 : -1;
    if (isChangeAbs(v) && !hasSigned(sign * v)) {
      return `«${m[2]}${m[3]}»: знак не тот`;
    }
  }
  return null;
}

// allowed — текст, из которого можно брать числа (строки фактов + заголовки);
// changes — изменения за 24 ч в % по монетам (со знаком); headlines — тексты
// заголовков: проценты из них можно пересказывать
export function checkSummary(
  summary: string,
  allowed: string,
  changes: number[] = [],
  headlines = '',
): { ok: true } | { ok: false; reason: string } {
  const ok = new Set(numbersIn(allowed));
  const extra = numbersIn(summary).filter((n) => !ok.has(n));
  if (extra.length > 0) {
    return {
      ok: false,
      reason: `числа не из данных: ${[...new Set(extra)].join(', ')}`,
    };
  }
  const dir = directionError(summary, changes, new Set(numbersIn(headlines)));
  if (dir) return { ok: false, reason: `направление: ${dir}` };
  const word = DIRECTIVE.exec(summary);
  if (word) return { ok: false, reason: `слово-указание: «${word[2]}»` };
  return { ok: true };
}
