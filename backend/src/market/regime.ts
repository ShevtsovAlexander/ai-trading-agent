// Режим рынка по ADX (TASK-0011): чистая функция, без запросов. Правило и
// порог — замер на дневной истории BTC/ETH/SOL (docs/RESEARCH.md, «Режим
// рынка: ADX на дневных свечах»), вариант (а): одна черта, без запаса.
// Это описание прошедших дней, не прогноз.

export type Regime = 'up' | 'down' | 'range';

// Период ADX и черта тренда — вариант (а) замера, решение человека 2026-11-03
export const ADX_PERIOD = 14;
export const REGIME_THRESHOLD = 25;

// Точка ADX на закрытии дня t. Без NaN: префикс разогрева calcADX отрезает
// вызывающий.
export interface RegimePoint {
  t: number;
  adx: number;
  pdi: number;
  mdi: number;
}

// ADX ≥ threshold — тренд, направление по большему DI; ниже — боковик.
// +DI = −DI при тренде — прошлый трендовый ярлык (после боковика — боковик):
// направления нет, менять его не на что. Точки — от старых к новым.
// since — индекс первого дня последней серии одинаковых ярлыков; пустой
// ряд — since −1.
export function classifyRegime(
  points: RegimePoint[],
  threshold: number,
): { labels: Regime[]; since: number } {
  const labels: Regime[] = [];
  let prev: Regime = 'range';
  for (const p of points) {
    let label: Regime;
    if (!(p.adx >= threshold)) label = 'range';
    else if (p.pdi > p.mdi) label = 'up';
    else if (p.mdi > p.pdi) label = 'down';
    else label = prev;
    labels.push(label);
    prev = label;
  }

  let since = labels.length - 1;
  while (since > 0 && labels[since - 1] === labels[labels.length - 1]) {
    since--;
  }
  return { labels, since };
}
