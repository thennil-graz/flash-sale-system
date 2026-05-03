export const theme = {
  colors: {
    primary:    '#E63946',
    success:    '#2DC653',
    error:      '#E63946',
    warning:    '#F4A261',
    neutral900: '#0D0D0D',
    neutral100: '#F5F5F5',
    surface:    '#FFFFFF',
    border:     '#E0E0E0',
  },
  typography: {
    fontFamily: "'Inter', sans-serif",
    sizes: { xs: '12px', sm: '14px', md: '16px', lg: '20px', xl: '28px' },
    weights: { regular: 400, medium: 500, bold: 700 },
  },
  spacing: {
    xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '40px',
  },
  radii: { sm: '4px', md: '8px', lg: '16px', full: '9999px' },
  shadows: {
    card:     '0 2px 8px rgba(0,0,0,0.08)',
    elevated: '0 4px 16px rgba(0,0,0,0.14)',
  },
} as const;

export type Theme = typeof theme;
