import { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { Dimensions } from 'react-native';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCREEN_WIDTH = Dimensions.get('window').width;

/** Minimum horizontal translation (30% of screen) to commit a left/right swipe. */
export const SWIPE_THRESHOLD_X = SCREEN_WIDTH * 0.3;

/** Minimum upward translation (px) to commit an up swipe (super like). */
export const SWIPE_THRESHOLD_Y = 120;

/**
 * Velocity (px/s) at which a swipe is committed regardless of translation distance.
 * Allows fast flick gestures to commit even when the card hasn't travelled far.
 */
export const VELOCITY_THRESHOLD = 500;

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
   * Called on the JS thread after a swipe is committed and the snap animation
   * has been scheduled. The card will be animating off-screen at this point.
   */
  onSwipe: (direction: SwipeDirection) => void;
}

interface UseSwipeGestureResult {
  /** RNGH v2 gesture to attach to <GestureDetector gesture={gesture}>. */
  gesture: ReturnType<typeof Gesture.Pan>;
  /** Reanimated animated style for the card's <Animated.View>. */
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  /** Reset all shared values to zero (call after the card has been removed from the tree). */
  resetCard: () => void;
}

/**
 * Pan gesture + spring animation hook for a swipe card.
 *
 * Usage:
 * ```tsx
 * const { gesture, animatedStyle, resetCard } = useSwipeGesture({ onSwipe: handleSwipe });
 *
 * return (
 *   <GestureDetector gesture={gesture}>
 *     <Animated.View style={animatedStyle}>
 *       <SwipeCard track={track} />
 *     </Animated.View>
 *   </GestureDetector>
 * );
 * ```
 *
 * Architectural notes:
 * - All animation runs on the UI thread (Reanimated worklet).
 * - onSwipe is called via runOnJS so it is safe to update Zustand store state.
 * - isAnimating guards against double-commits on fast successive touches.
 */
export function useSwipeGesture({ onSwipe }: UseSwipeGestureOptions): UseSwipeGestureResult {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Subtle rotation proportional to horizontal travel (max ±15 degrees).
  const rotation = useSharedValue(0);
  // Guard: prevents a second gesture starting while the snap animation plays.
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

        // Snap the card off-screen in the committed direction.
        const targetX =
          direction === 'left'
            ? -SCREEN_WIDTH * 1.5
            : direction === 'right'
              ? SCREEN_WIDTH * 1.5
              : 0;
        const targetY = direction === 'up' ? -800 : 0;

        translateX.value = withSpring(targetX, {
          velocity: event.velocityX,
          overshootClamping: true,
        });
        translateY.value = withSpring(targetY, {
          velocity: event.velocityY,
          overshootClamping: true,
        });

        // Notify the JS thread so the store can advance the card stack.
        // runOnJS is required because onSwipe touches JS-thread Zustand state.
        runOnJS(onSwipe)(direction);
      } else {
        // Below threshold — spring back to resting position.
        translateX.value = withSpring(0, { stiffness: 300, damping: 30 });
        translateY.value = withSpring(0, { stiffness: 300, damping: 30 });
        rotation.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  /**
   * Reset all shared values to zero. Call this after the old card component
   * has been removed from the tree so the new card starts at rest.
   */
  function resetCard(): void {
    translateX.value = 0;
    translateY.value = 0;
    rotation.value = 0;
    isAnimating.value = false;
  }

  return { gesture, animatedStyle, resetCard };
}
