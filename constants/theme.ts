export const Ocean = {
  bg: '#0B1033',
  surface: '#111A45',
  card: '#1A2260',
  cardBorder: '#252F6A',
  accent: '#4ECDC4',
  accentDim: 'rgba(78,205,196,0.15)',
  textPrimary: '#FFFFFF',
  textSecondary: '#8892B0',
  textMuted: '#4A547A',
  elevated: '#F59E0B',
  low: '#7B8FD4',
  mixed: '#C084FC',
  success: '#4ECDC4',
  warning: '#F59E0B',
  danger: '#FF6B6B',
  tabBar: '#0D1240',
  tabBarBorder: '#252F70',
} as const;

// Single source of truth lives in the dependency-free analysis module.
export type { MoodState } from '@/lib/analysis';
import type { MoodState } from '@/lib/analysis';

export const stateColor = (s: MoodState): string =>
  s === 'elevated' ? Ocean.elevated : s === 'low' ? Ocean.low : s === 'mixed' ? Ocean.mixed : Ocean.accent;

export const stateLabel: Record<MoodState, string> = {
  stable: 'Stable',
  elevated: 'Elevated',
  low: 'Low',
  mixed: 'Mixed',
};

export const radius = { sm: 8, md: 14, lg: 20 } as const;
