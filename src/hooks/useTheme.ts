import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { getColors, type Colors } from '@/theme';
import { usePrefsStore } from '@/stores/prefsStore';

export interface ThemeResult {
  activeColors: Colors;
  isDark: boolean;
}

export function useTheme(): ThemeResult {
  const themeMode = usePrefsStore((s) => s.themeMode);
  const colorScheme = useColorScheme();
  const isDark = themeMode === 'dark' || (themeMode === 'system' && colorScheme === 'dark');
  const activeColors = useMemo(() => getColors(isDark), [isDark]);
  return { activeColors, isDark };
}
