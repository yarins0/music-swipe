import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { SwipeCard } from '@/swipe/SwipeCard';
import { useSwipeGesture } from '@/swipe/useSwipeGesture';
import type { SwipeDirection } from '@/swipe/useSwipeGesture';
import type { Track } from '@/adapters/interface';

interface SwipeFrontCardProps {
  track: Track;
  onSwipe: (direction: SwipeDirection) => void;
  onHaptic?: () => void;
  onSeekBack: () => void;
  onSeekForward: () => void;
  isSeekEnabled: boolean;
  showAlbumArt: boolean;
  /** Optional debug border + label for the swipe-flicker investigation. */
  debug?: boolean;
}

/**
 * The interactive (gesture-driven) top card in the swipe deck.
 *
 * This component is intentionally NOT remounted between tracks. Keeping the
 * same instance means the expo-image inside SwipeCard updates its source URL
 * in-place (using its memory cache for the new track's art, which was already
 * loaded while that track was the back card). A remount would create a new
 * Image instance that takes one native frame to paint even from cache, causing
 * a black flash.
 *
 * Instead, the gesture's shared values (translateX/Y/rotation) are reset via
 * useEffect when track.id changes. At that point the card is already off-screen
 * at the fly-off position — so the reset is invisible. The next frame shows
 * the new track's content at center, fully rendered.
 */
export function SwipeFrontCard({
  track,
  onSwipe,
  onHaptic,
  onSeekBack,
  onSeekForward,
  isSeekEnabled,
  showAlbumArt,
  debug = false,
}: SwipeFrontCardProps): React.ReactElement {
  const { gesture, animatedStyle, resetCard } = useSwipeGesture({ onSwipe, onHaptic });

  // When the track changes, the card is at the fly-off position (off-screen).
  // Reset to center so the new track appears correctly on the next frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { resetCard(); }, [track.id]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.card,
          animatedStyle as object,
          debug && styles.debugBorder,
        ]}
      >
        <SwipeCard
          track={track}
          onSeekBack={onSeekBack}
          onSeekForward={onSeekForward}
          isSeekEnabled={isSeekEnabled}
          showAlbumArt={showAlbumArt}
        />
        {debug && (
          <View style={styles.debugLabel} pointerEvents="none">
            <Text style={styles.debugLabelText}>
              FRONT · {track.title.slice(0, 20)} · id={track.id.slice(-6)}
            </Text>
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  debugBorder: {
    borderWidth: 4,
    borderColor: 'red',
  },
  debugLabel: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(255,0,0,0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  debugLabelText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'Outfit_700Bold',
  },
});
