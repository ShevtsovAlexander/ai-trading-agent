export const theme = {
    colors: {
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
    radius: {
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
    },
    fontSize: {
        xs: '10px',
        sm: '11px',
        md: '13px',
        base: '14px',
        lg: '16px',
        xl: '22px',
    },
};

export type Theme = typeof theme;