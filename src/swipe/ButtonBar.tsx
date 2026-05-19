import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface ButtonBarProps {
  onUndo: () => void;
  onSkip: () => void;
  onSuperLike: () => void;
  onLike: () => void;
  onDecideLater: () => void;
  canUndo: boolean;
  isDecideLaterEnabled: boolean;
}

export function ButtonBar({
  onUndo,
  onSkip,
  onSuperLike,
  onLike,
  onDecideLater,
  canUndo,
  isDecideLaterEnabled,
}: ButtonBarProps): React.ReactElement {
  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.button, !canUndo && styles.dimmed]}
        onPress={canUndo ? onUndo : undefined}
        accessibilityRole="button"
        accessibilityLabel="Undo"
        accessibilityState={{ disabled: !canUndo }}
      >
        <Text style={styles.icon}>↩</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel="Skip"
      >
        <Text style={styles.icon}>✕</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={onSuperLike}
        accessibilityRole="button"
        accessibilityLabel="Super Like"
      >
        <Text style={styles.icon}>⭐</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={onLike}
        accessibilityRole="button"
        accessibilityLabel="Like"
      >
        <Text style={styles.icon}>♥</Text>
      </Pressable>

      <Pressable
        style={[styles.button, !isDecideLaterEnabled && styles.dimmed]}
        onPress={isDecideLaterEnabled ? onDecideLater : undefined}
        accessibilityRole="button"
        accessibilityLabel="Decide Later"
        accessibilityState={{ disabled: !isDecideLaterEnabled }}
      >
        <Text style={styles.icon}>⏱</Text>
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
  },
  button: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dimmed: {
    opacity: 0.3,
  },
  icon: {
    fontSize: 24,
  },
});
