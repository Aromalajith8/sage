// src/utils/theme.ts
// Sage design system — black/white only + one daily accent color for the logo

export const Colors = {
  bg:         '#000000',
  surface:    '#0a0a0a',
  border:     '#1a1a1a',
  borderDim:  '#111111',
  text:       '#ffffff',
  textDim:    '#888888',
  textMuted:  '#444444',
  inputBg:    '#0f0f0f',
  // No other colors except the daily Sage accent
} as const;

// Sage logo cycles: terminal yellow → terminal blue → terminal red
// Changes every calendar day (UTC)
const SAGE_COLORS = ['#f0c040', '#4a9eff', '#ff4444'] as const;

export function getSageColor(): string {
  const dayOfYear = Math.floor(Date.now() / 86400000); // days since epoch
  return SAGE_COLORS[dayOfYear % SAGE_COLORS.length];
}

export const Font = {
  mono:   'Courier New',
  size: {
    xs:   11,
    sm:   13,
    base: 15,
    lg:   18,
    xl:   24,
    xxl:  32,
  }
} as const;

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
} as const;
