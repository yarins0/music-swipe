import React from 'react';
import { StyleSheet, View } from 'react-native';

interface TrackProgressDotsProps {
  /** Number of segments the track is divided into (matches the tap-to-seek step). */
  totalSegments: number;
  /** Index of the segment currently playing (0-based, clamped to [0, totalSegments - 1]). */
  currentSegment: number;
}

/**
 * Renders one dot per playback segment, highlighting the segment currently
 * playing — a visual readout of "which part of the track" is audible right now.
 *
 * Segments mirror the tap-to-seek step (see computeSeekStepMs in SwipeEngine),
 * so each dot corresponds to exactly one seek-forward/seek-back tap.
 *
 * Renders nothing when there is only one segment — a single dot would carry
 * no information.
 */
export function TrackProgressDots({
  totalSegments,
  currentSegment,
}: TrackProgressDotsProps): React.ReactElement | null {
  if (totalSegments <= 1) return null;

  const clampedCurrent = Math.max(0, Math.min(currentSegment, totalSegments - 1));

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {Array.from({ length: totalSegments }, (_, index) => (
        <View
          key={index}
          style={[styles.dot, index === clampedCurrent && styles.dotActive]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginBottom: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
});
