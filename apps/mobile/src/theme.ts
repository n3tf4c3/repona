import { Platform } from 'react-native';

export const colors = {
  bg: '#F6F5EF',
  bg2: '#EFEEE6',
  surface: '#FFFFFF',
  surface2: '#FBFAF5',
  ink: '#212418',
  ink2: '#5C604F',
  ink3: '#8E9180',
  line: '#E7E5D9',
  line2: '#EFEDE3',
  primary: '#2E8B57',
  primaryStrong: '#236B43',
  primarySoft: '#E2F0E5',
  primaryTint: '#F0F7F0',
  amber: '#E0913B',
  amberSoft: '#FBEAD4',
  coral: '#E0604A',
  coralSoft: '#FAE1DB',
  indigo: '#6471DE',
  indigoSoft: '#E7E9FB',
};

export const spacing = {
  screen: 20,
};

export const radius = {
  card: 20,
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
