export interface Colors {
  primary: string;
  primaryDark: string;
  background: string;
  surface: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  rewind: string;
  nope: string;
  superLike: string;
  like: string;
  later: string;
}

export const lightColors: Colors = {
  primary: '#fd297b',
  primaryDark: '#b70053',
  background: '#f8f9fb',
  surface: '#ffffff',
  surfaceContainerHigh: '#e6e8ea',
  surfaceContainerHighest: '#e0e3e5',
  onSurface: '#191c1e',
  onSurfaceVariant: '#5b3f45',
  outline: '#8f6f75',
  outlineVariant: '#e4bdc4',
  rewind: '#f5d300',
  nope: '#fe3d52',
  superLike: '#3da2ff',
  like: '#21d191',
  later: '#9c59ff',
};

export const darkColors: Colors = {
  primary: '#fd297b',
  primaryDark: '#b70053',
  background: '#0f1117',
  surface: '#1c1f26',
  surfaceContainerHigh: '#2a2d35',
  surfaceContainerHighest: '#313540',
  onSurface: '#e8eaed',
  onSurfaceVariant: '#9aa0aa',
  outline: '#6b7280',
  outlineVariant: '#2e3240',
  rewind: '#f5d300',
  nope: '#fe3d52',
  superLike: '#3da2ff',
  like: '#21d191',
  later: '#9c59ff',
};

// Backward-compatible alias — existing code importing `colors` gets the light palette.
export const colors = lightColors;

export function getColors(isDark: boolean): Colors {
  return isDark ? darkColors : lightColors;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};
