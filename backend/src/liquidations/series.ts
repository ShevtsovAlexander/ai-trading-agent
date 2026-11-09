import { Last24h, LiqPoint } from './liquidations.types';
import { LiqBar } from './sources';

// Сумма бирж на полной сетке [start, start + bars · step). Записи нет ни у
// одной биржи — null, а не ноль; запись только у одной — сумма по ней: у
// остальных источник за эту свечу ничего не отдал. Метка не на сетке или дубль
// биржи — порча данных, ошибка. Точки вне окна в ряд не попадают.
export function buildLiqSeries(
  start: number,
  stepMs: number,
  bars: number,
  rows: LiqBar[][],
): LiqPoint[] {
  const cells = new Map<number, { long: number; short: number }>();
  for (const row of rows) {
    const seen = new Set<number>();
    for (const bar of row) {
      if ((bar.t - start) % stepMs !== 0) {
        throw new Error(`Coinalyze: метка ${bar.t} не на сетке шага ${stepMs}`);
      }
      if (seen.has(bar.t)) throw new Error(`Coinalyze: дубль метки ${bar.t}`);
      seen.add(bar.t);
      const cell = cells.get(bar.t) ?? { long: 0, short: 0 };
      cell.long += bar.long;
      cell.short += bar.short;
      cells.set(bar.t, cell);
    }
  }
  return Array.from({ length: bars }, (_, i) => {
    const t = start + i * stepMs;
    const cell = cells.get(t);
    return {
      t,
      longUsd: cell ? cell.long : null,
      shortUsd: cell ? cell.short : null,
    };
  });
}

// Сумма по свечам окна; свеча без записи не добавляет ничего
export function sumLast24h(points: LiqPoint[], stepMs: number): Last24h {
  return {
    longUsd: points.reduce((sum, p) => sum + (p.longUsd ?? 0), 0),
    shortUsd: points.reduce((sum, p) => sum + (p.shortUsd ?? 0), 0),
    from: points[0].t,
    to: points[points.length - 1].t + stepMs,
  };
}
