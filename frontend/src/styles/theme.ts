// Язык ClickHouse (docs/design/clickhouse.DESIGN.md) — палитра, шрифты,
// радиусы. Доопределения для дашборда (рост/падение, график) —
// docs/aidd/plan/TASK-0003.md. Литералы цвета — только здесь.
const palette = {
    canvas: '#0a0a0a',
    surfaceSoft: '#121212',
    surfaceCard: '#1a1a1a',
    surfaceElevated: '#242424',
    hairline: '#2a2a2a',
    hairlineStrong: '#3a3a3a',
    ink: '#ffffff',
    bodyStrong: '#e6e6e6',
    body: '#cccccc',
    muted: '#888888',
    mutedSoft: '#5a5a5a',
    // Жёлтый — единственный брендовый цвет, скупо: шапка, цена, последняя
    // цена на шкале, «AI-свод» (план, вопрос 4)
    primary: '#faff69',
    primaryActive: '#e6eb52',
    primaryDisabled: '#3a3a1f',
    onPrimary: '#0a0a0a',
    // Рост/падение — старт с цветов DESIGN.md, подбор глазом (план, вопрос 1)
    up: '#22c55e',
    down: '#ef4444',
    warning: '#f59e0b',
};

export const theme = {
    colors: {
        ...palette,
        // Старые токены — до перевода компонентов (TASK-0003.8)
        bg: '#0d0d0d',
        surface: '#1a1a1a',
        surfaceAlt: '#111',
        border: '#2a2a2a',
        borderLight: '#1f1f1f',
        text: '#ffffff',
        textSecondary: '#888',
        textMuted: '#555',
        purple: '#a78bfa',
        green: '#4ade80',
        red: '#f87171',
        amber: '#f59e0b',
        blue: '#378ADD',
        btc: '#F7931A',
        eth: '#627EEA',
        sol: '#9945FF',
    },
    // Серии графика — серым, без второго брендового цвета (план, вопрос 3)
    chart: {
        emaFast: palette.bodyStrong,
        emaSlow: palette.muted,
        bandLine: palette.hairlineStrong,
        bandFill: `${palette.ink}0a`,
        grid: palette.surfaceSoft,
        crosshair: palette.muted,
    },
    font: {
        sans: '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
    },
    radius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '12px',
    },
    fontSize: {
        xs: '10px',
        sm: '11px',
        md: '13px',
        base: '14px',
        lg: '16px',
        xl: '22px',
        // Цена в карточке: stat-display D (56px) не влезает в колонку
        display: '28px',
    },
};

export type Theme = typeof theme;
