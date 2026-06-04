import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

interface ButtonBarProps {
  onUndo: () => void;
  onSkip: () => void;
  onSuperLike: () => void;
  onLike: () => void;
  onDecideLater: () => void;
  canUndo: boolean;
  isDecideLaterEnabled: boolean;
  /** When true, the skip button shows a destructive delete icon instead of the neutral skip icon. */
  isFilterMode?: boolean;
}

export function ButtonBar({
  onUndo,
  onSkip,
  onSuperLike,
  onLike,
  onDecideLater,
  canUndo,
  isDecideLaterEnabled,
  isFilterMode = false,
}: ButtonBarProps): React.ReactElement {
  const { activeColors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [isDark]);

  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.smallButton, !canUndo && styles.dimmed]}
        onPress={canUndo ? onUndo : undefined}
        accessibilityRole="button"
        accessibilityLabel="Undo"
        accessibilityState={{ disabled: !canUndo }}
      >
        <Text style={[styles.smallIcon, styles.thickIcon, { color: activeColors.rewind }]}>↺</Text>
      </Pressable>

      <Pressable
        style={styles.largeButton}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={isFilterMode ? 'Delete from playlist' : 'Skip'}
      >
        {isFilterMode ? (
          // Destructive icon in filter mode — signals that left swipe permanently deletes
          <View style={styles.filterSkipContent}>
            <Ionicons name="trash-outline" size={26} color={activeColors.nope} />
            <Text style={[styles.filterSkipLabel, { color: activeColors.nope }]}>DELETE</Text>
          </View>
        ) : (
          <Text style={[styles.largeIcon, { color: activeColors.nope }]}>✕</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.smallButton}
        onPress={onSuperLike}
        accessibilityRole="button"
        accessibilityLabel="Super Like"
      >
        <Text style={[styles.largeIcon, styles.thickIcon, { color: activeColors.superLike }]}>★</Text>
      </Pressable>

      <Pressable
        style={styles.largeButton}
        onPress={onLike}
        accessibilityRole="button"
        accessibilityLabel="Like"
      >
        <Text style={[styles.largeIcon, { color: activeColors.like }]}>♥</Text>
      </Pressable>

      <Pressable
        style={[styles.smallButton, !isDecideLaterEnabled && styles.dimmed]}
        onPress={isDecideLaterEnabled ? onDecideLater : undefined}
        accessibilityRole="button"
        accessibilityLabel="Decide Later"
        accessibilityState={{ disabled: !isDecideLaterEnabled }}
      >
        <Text style={[styles.smallIcon, styles.thickIcon, { color: activeColors.later }]}>⏱</Text>
      </Pressable>
    </View>
  );
}

function createStyles(c: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      alignItems: 'center',
      width: '100%',
      paddingHorizontal: 8,
    },
    smallButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: c.surface,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 4,
      borderWidth: 1,
      borderColor: c.outlineVariant,
    },
    largeButton: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: c.surface,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 6,
      borderWidth: 1,
      borderColor: c.outlineVariant,
    },
    smallIcon: { fontSize: 22 },
    thickIcon: { fontWeight: '800' },
    largeIcon: { fontSize: 28 },
    dimmed: { opacity: 0.3 },
    filterSkipContent: { alignItems: 'center', gap: 2 },
    filterSkipLabel: { fontSize: 9, fontFamily: 'Outfit_600SemiBold', letterSpacing: 0.5 },
  });
}
