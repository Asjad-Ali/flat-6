import { Platform, type ViewStyle } from 'react-native';

export const colors = {
  primary: '#4F46E5',
  primaryDark: '#3730A3',
  primarySoft: '#EEF2FF',
  background: '#F5F6FA',
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  text: '#0F172A',
  textMuted: '#64748B',
  textFaint: '#94A3B8',
  textOnPrimary: '#FFFFFF',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  info: '#0284C7',
  infoSoft: '#E0F2FE',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const font = {
  caption: 12,
  small: 13,
  body: 15,
  subtitle: 17,
  title: 20,
  headline: 26,
  display: 32,
} as const;

export const shadow: ViewStyle = Platform.select<ViewStyle>({
  android: { elevation: 2 },
  default: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
})!;
