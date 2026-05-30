import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

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
  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.smallButton, !canUndo && styles.dimmed]}
        onPress={canUndo ? onUndo : undefined}
        accessibilityRole="button"
        accessibilityLabel="Undo"
        accessibilityState={{ disabled: !canUndo }}
      >
        <Text style={[styles.smallIcon, { color: colors.rewind }]}>↺</Text>
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
            <Ionicons name="trash-outline" size={26} color={colors.nope} />
            <Text style={styles.filterSkipLabel}>DELETE</Text>
          </View>
        ) : (
          <Text style={[styles.largeIcon, { color: colors.nope }]}>✕</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.smallButton}
        onPress={onSuperLike}
        accessibilityRole="button"
        accessibilityLabel="Super Like"
      >
        <Text style={[styles.smallIcon, { color: colors.superLike }]}>★</Text>
      </Pressable>

      <Pressable
        style={styles.largeButton}
        onPress={onLike}
        accessibilityRole="button"
        accessibilityLabel="Like"
      >
        <Text style={[styles.largeIcon, { color: colors.like }]}>♥</Text>
      </Pressable>

      <Pressable
        style={[styles.smallButton, !isDecideLaterEnabled && styles.dimmed]}
        onPress={isDecideLaterEnabled ? onDecideLater : undefined}
        accessibilityRole="button"
        accessibilityLabel="Decide Later"
        accessibilityState={{ disabled: !isDecideLaterEnabled }}
      >
        <Text style={[styles.smallIcon, { color: colors.later }]}>⏱</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  largeButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  smallIcon: { fontSize: 22 },
  largeIcon: { fontSize: 28 },
  dimmed: { opacity: 0.3 },
  filterSkipContent: { alignItems: 'center', gap: 2 },
  filterSkipLabel: { fontSize: 9, fontFamily: 'Outfit_600SemiBold', color: colors.nope, letterSpacing: 0.5 },
});
