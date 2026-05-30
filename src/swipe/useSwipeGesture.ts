import { useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { Dimensions } from 'react-native';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCREEN_WIDTH = Dimensions.get('window').width;
export const SCREEN_HEIGHT = Dimensions.get('window').height;

/** Minimum horizontal translation (30% of screen) to commit a left/right swipe. */
export const SWIPE_THRESHOLD_X = SCREEN_WIDTH * 0.3;

/** Minimum upward translation (px) to commit an up swipe (super like). */
export const SWIPE_THRESHOLD_Y = 120;

/**
 * Velocity (px/s) at which a swipe is committed regardless of translation distance.
 * Allows fast flick gestures to commit even when the card hasn't travelled far.
 */
export const VELOCITY_THRESHOLD = 500;

/** Duration of the fly-off animation when a swipe commits. */
const FLY_OFF_DURATION = 250;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The three commitable swipe directions in this app:
 * - 'right' → like
 * - 'left'  → skip
 * - 'up'    → super like
 */
export type SwipeDirection = 'left' | 'right' | 'up';

// ---------------------------------------------------------------------------
// Pure function — safe to call from both JS thread and worklets
// ---------------------------------------------------------------------------

/**
 * Determine whether a pan gesture has crossed the commit threshold, and in
 * which direction. Returns null when the gesture is below all thresholds
 * (card should spring back to center).
 *
 * Priority: up > right > left (matches standard super-like card stack UX).
 */
export function detectSwipeDirection(
  translationX: number,
  translationY: number,
  velocityX: number,
  velocityY: number,
): SwipeDirection | null {
  'worklet';
  const isUpSwipe =
    translationY < -SWIPE_THRESHOLD_Y || velocityY < -VELOCITY_THRESHOLD;
  const isRightSwipe =
    translationX > SWIPE_THRESHOLD_X || velocityX > VELOCITY_THRESHOLD;
  const isLeftSwipe =
    translationX < -SWIPE_THRESHOLD_X || velocityX < -VELOCITY_THRESHOLD;

  // Up takes priority: the user must be moving more vertically than horizontally
  // to avoid accidentally triggering super like on a diagonal right swipe.
  if (isUpSwipe && Math.abs(translationY) > Math.abs(translationX)) return 'up';
  if (isRightSwipe) return 'right';
  if (isLeftSwipe) return 'left';
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseSwipeGestureOptions {
  /**
   * Called on the JS thread AFTER the fly-off animation completes. The card
   * will be off-screen at this point. The parent should advance state so this
   * component unmounts and the next card mounts in its place.
   */
  onSwipe: (direction: SwipeDirection) => void;
  /**
   * Optional callback fired on the JS thread when a swipe is committed.
   * Intended for triggering haptic feedback without coupling the worklet to
   * a specific haptics library.
   */
  onHaptic?: () => void;
}

interface UseSwipeGestureResult {
  /** RNGH v2 gesture to attach to <GestureDetector gesture={gesture}>. */
  gesture: ReturnType<typeof Gesture.Pan>;
  /** Reanimated animated style for the card's <Animated.View>. */
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  /**
   * Reset all shared values to resting state. Call when the track changes
   * (without remounting the component) so the new track starts centered with
   * no stale fly-off offset. Safe to call while the card is off-screen.
   */
  resetCard: () => void;
}

/**
 * Pan gesture + fly-off animation hook for a single swipe card.
 *
 * This hook owns ONE card's animation state. When the parent remounts the
 * card (via `key={track.id}`), this hook is re-created with fresh shared
 * values defaulting to centered + visible. The previous card's off-screen
 * fly-off state belongs to its own hook instance, which is garbage collected
 * along with the unmounted view. There is no shared mutable state between
 * cards, which is what eliminates the "gap frame" the user perceived as a
 * flicker.
 *
 * Usage:
 * ```tsx
 * const { gesture, animatedStyle } = useSwipeGesture({ onSwipe: handleSwipe });
 *
 * return (
 *   <GestureDetector gesture={gesture}>
 *     <Animated.View style={animatedStyle}>
 *       <SwipeCard track={track} />
 *     </Animated.View>
 *   </GestureDetector>
 * );
 * ```
 */
export function useSwipeGesture({ onSwipe, onHaptic }: UseSwipeGestureOptions): UseSwipeGestureResult {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Subtle rotation proportional to horizontal travel.
  const rotation = useSharedValue(0);
  // Guard: prevents a second gesture starting while the fly-off animation plays.
  const isAnimating = useSharedValue(false);

  const gesture = Gesture.Pan()
    .onUpdate((event) => {
      if (isAnimating.value) return;
      translateX.value = event.translationX;
      translateY.value = event.translationY;
      rotation.value = (event.translationX / SCREEN_WIDTH) * 15;
    })
    .onEnd((event) => {
      if (isAnimating.value) return;

      const direction = detectSwipeDirection(
        event.translationX,
        event.translationY,
        event.velocityX,
        event.velocityY,
      );

      if (direction !== null) {
        isAnimating.value = true;

        // Animate the card off-screen. onSwipe fires in the completion callback,
        // not immediately — so by the time React advances state and unmounts this
        // card, the user has already seen it fly away. The next card mounts as
        // a fresh component with its own shared values defaulting to centered +
        // visible, so there is no opacity / position gap during the swap.
        const horizontalTarget =
          direction === 'right' ? SCREEN_WIDTH * 1.5
          : direction === 'left' ? -SCREEN_WIDTH * 1.5
          : event.translationX;
        const verticalTarget = direction === 'up' ? -SCREEN_HEIGHT : event.translationY;
        const rotationTarget = (horizontalTarget / SCREEN_WIDTH) * 30;
        const config = { duration: FLY_OFF_DURATION, easing: Easing.out(Easing.cubic) };

        translateY.value = withTiming(verticalTarget, config);
        rotation.value = withTiming(rotationTarget, config);
        translateX.value = withTiming(horizontalTarget, config, (finished) => {
          if (finished) {
            runOnJS(onSwipe)(direction);
            if (onHaptic) runOnJS(onHaptic)();
          }
        });
      } else {
        // Below threshold — ease back to resting position.
        const snapBack = { duration: 300, easing: Easing.out(Easing.cubic) };
        translateX.value = withTiming(0, snapBack);
        translateY.value = withTiming(0, snapBack);
        rotation.value = withTiming(0, snapBack);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  function resetCard(): void {
    translateX.value = 0;
    translateY.value = 0;
    rotation.value = 0;
    isAnimating.value = false;
  }

  return { gesture, animatedStyle, resetCard };
}
