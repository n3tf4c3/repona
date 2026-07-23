import { Platform } from 'react-native';

export const colors = {
  bg: '#f9faf6',
  bg2: '#f3f4f0',
  surface: '#ffffff',
  surface2: '#f3f4f0',
  ink: '#1a1c1a',
  ink2: '#404943',
  // Texto auxiliar ainda precisa de 4,5:1 tanto sobre surface quanto sobre bg.
  ink3: '#69726c',
  line: '#bfc9c1',
  line2: '#e7e9e5',
  // Mantém texto branco acima de 4,5:1 (WCAG AA para texto pequeno).
  primary: '#2d6a4f',
  primaryStrong: '#0f5238',
  primarySoft: '#a8e7c5',
  primaryTint: '#f9faf6',
  amber: '#e0913b',
  amberSoft: '#fbead4',
  coral: '#ba1a1a',
  coralSoft: '#ffdad6',
  indigo: '#3e6750',
  indigoSoft: '#bdeacd',
};

export const spacing = {
  screen: 20,
};

export const radius = {
  card: 24,
};

export const shadow = {
  small: Platform.select({
    ios: {
      shadowColor: colors.ink,
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: {},
  }) ?? {},
  medium: Platform.select({
    ios: {
      shadowColor: colors.ink,
      shadowOpacity: 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 8 },
    default: {},
  }) ?? {},
};

export const typography = {
  h1: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800' as const,
    letterSpacing: -0.4,
  },
  h2: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800' as const,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600' as const,
  },
  bodySmall: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700' as const,
  },
  labelStrong: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800' as const,
  },
  badge: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800' as const,
  },
};
