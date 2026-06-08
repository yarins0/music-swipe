import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

interface TabHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional node rendered in the right slot of the header row (e.g. an icon button). */
  rightAction?: React.ReactNode;
}

export function TabHeader({ title, subtitle, rightAction }: TabHeaderProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      {/* 3-column layout: left spacer | centered content | right action */}
      <View style={styles.row}>
        <View style={styles.sideSlot} />
        <View style={styles.centerContent}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={styles.rightSlot}>
          {rightAction}
        </View>
      </View>
    </View>
  );
}

function createStyles(c: Colors) {
  return StyleSheet.create({
    header: {
      paddingBottom: 12,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.surfaceContainerHigh,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // Left spacer mirrors the right slot width so the center content stays truly centered.
    sideSlot: {
      flex: 1,
    },
    centerContent: {
      alignItems: 'center',
    },
    rightSlot: {
      flex: 1,
      alignItems: 'flex-end',
    },
    title: {
      fontSize: 18,
      fontFamily: 'Outfit_700Bold',
      color: c.primary,
      letterSpacing: -0.3,
    },
    subtitle: {
      fontSize: 12,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
      marginTop: 2,
    },
  });
}
