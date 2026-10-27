import { FundingPayment, Stress } from './derivatives.types';

export const STRESS_PERIOD_DAYS = 365; // окно «нормы» — решение человека (T1)
// Нейтральная ставка Binance за 8 ч (interestRate). На другом интервале
// нейтраль не установлена — подтверждена 7 точками (RESEARCH.md, funding)
export const NEUTRAL_RATE = 0.0001;
const NEUTRAL_INTERVAL_HOURS = 8;
// «Ровно» — шаг ставок Binance 1e-8, допуск на неточность float (критик T1)
const EPS = 1e-9;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// fundingTime у Binance дрожит на миллисекунды (28 800 001, 28 799 992) —
// шаги округляются до часа, иначе 8 ч не совпало бы почти никогда
const hours = (ms: number) => Math.round(ms / HOUR_MS);

// Насколько текущая ставка необычна — от нейтральной, не от среднего:
// z-score и процентиль называют нейтральную «высокой» (TASK-0007.1).
// history — выплаты по возрастанию t; учитываются только t ≤ now.
// Текущий интервал — от последней выплаты до nextFundingTime: по двум
// последним выплатам он отставал бы на выплату после смены (SOL 2022-11-09,
// критик T3). Окно — выплаты с t в (now − 365 дн, now] с шагом 8 ч от
// предыдущей: ставки за 2–4 ч не сравниваются со ставками за 8 ч (иначе у
// SOL год после FTX в окне лежала 101 такая выплата). Первая выплата
// истории без предыдущей в окно не входит. null — сравнивать не с чем.
export function fundingStress(
  history: FundingPayment[],
  rate: number,
  nextFundingTime: number,
  now: number,
): Stress | null {
  const upto = history.filter((p) => p.t <= now);
  if (upto.length === 0) return null;

  const intervalHours = hours(nextFundingTime - upto[upto.length - 1].t);
  const from = now - STRESS_PERIOD_DAYS * DAY_MS;
  const window = upto
    .filter(
      (p, i) =>
        i > 0 &&
        p.t > from &&
        hours(p.t - upto[i - 1].t) === NEUTRAL_INTERVAL_HOURS,
    )
    .map((p) => p.rate);
  if (window.length === 0) return null;

  const base = {
    periodDays: STRESS_PERIOD_DAYS,
    samples: window.length,
    intervalHours,
  };
  if (intervalHours !== NEUTRAL_INTERVAL_HOURS) {
    return { ...base, state: 'unknown', tailPct: null };
  }
  if (Math.abs(rate - NEUTRAL_RATE) < EPS) {
    return { ...base, state: 'neutral', tailPct: null };
  }

  const share = (hit: (r: number) => boolean) =>
    (window.filter(hit).length / window.length) * 100;
  if (rate > NEUTRAL_RATE) {
    return { ...base, state: 'above', tailPct: share((r) => r >= rate - EPS) };
  }
  return {
    ...base,
    state: rate >= 0 ? 'below' : 'negative',
    tailPct: share((r) => r <= rate + EPS),
  };
}
