import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

interface SegmentNavigatorProps {
  /** Called when the user taps the left half (seek backward). */
  onSeekBack: () => void;
  /** Called when the user taps the right half (seek forward). */
  onSeekForward: () => void;
  /**
   * When true, taps are absorbed but neither callback is invoked.
   * Use during loading, transitions, or when seek is unsupported.
   */
  disabled?: boolean;
}

/**
 * SegmentNavigator renders two transparent touch zones that overlay the parent
 * container side by side (50 / 50 split). Tapping the left zone calls
 * onSeekBack; tapping the right zone calls onSeekForward.
 *
 * The component is designed as an overlay — it has no visible UI of its own.
 * Position it with `StyleSheet.absoluteFill` or equivalent in the parent.
 *
 * The interface is intentionally thin so that it can be upgraded to
 * AI-segment-aware seeking (v2) without changing the call sites.
 */
export function SegmentNavigator({
  onSeekBack,
  onSeekForward,
  disabled = false,
}: SegmentNavigatorProps): React.ReactElement {
  const handleSeekBack = (): void => {
    if (disabled) return;
    onSeekBack();
  };

  const handleSeekForward = (): void => {
    if (disabled) return;
    onSeekForward();
  };

  return (
    <View style={styles.container} pointerEvents={disabled ? 'none' : 'box-none'}>
      <Pressable
        style={styles.half}
        onPress={handleSeekBack}
        accessibilityRole="button"
        accessibilityLabel="Seek backward"
        accessibilityState={{ disabled }}
      />
      <Pressable
        style={styles.half}
        onPress={handleSeekForward}
        accessibilityRole="button"
        accessibilityLabel="Seek forward"
        accessibilityState={{ disabled }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Fills the parent; callers should place this with absoluteFill
    flex: 1,
    flexDirection: 'row',
  },
  half: {
    flex: 1,
    // Fully transparent — the Pressable is an invisible touch target
    backgroundColor: 'transparent',
  },
});
