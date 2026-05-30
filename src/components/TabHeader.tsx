import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

interface TabHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional node rendered in the right slot of the header row (e.g. an icon button). */
  rightAction?: React.ReactNode;
}

export function TabHeader({ title, subtitle, rightAction }: TabHeaderProps): React.ReactElement {
  const insets = useSafeAreaInsets();
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

const styles = StyleSheet.create({
  header: {
    paddingBottom: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
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
    color: colors.primary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
});
