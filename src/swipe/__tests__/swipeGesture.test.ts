/**
 * Tests for detectSwipeDirection pure function and useSwipeGesture hook.
 *
 * Strategy: detectSwipeDirection is a pure function and needs no mocking.
 * The hook wires together RNGH + Reanimated which are hard to exercise in
 * Jest; its integration is covered by E2E tests. Here we verify the hook
 * can be imported and returns the correct shape, using lightweight mocks.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports
// ---------------------------------------------------------------------------

jest.mock('react-native', () => ({
  Dimensions: {
    get: jest.fn().mockReturnValue({ width: 390, height: 844 }),
  },
}));

jest.mock('react-native-reanimated', () => {
  const makeSharedValue = (initial: number) => ({ value: initial });
  return {
    useSharedValue: jest.fn((v: number) => makeSharedValue(v)),
    useAnimatedStyle: jest.fn((fn: () => object) => fn()),
    withTiming: jest.fn((target: number) => target),
    withSpring: jest.fn((target: number) => target),
    runOnJS: jest.fn((fn: (...args: unknown[]) => unknown) => fn),
    Easing: { out: jest.fn(() => jest.fn()), cubic: jest.fn() },
  };
});

// Capture the gesture handlers the hook registers so tests can invoke them
// directly (RNGH's real gesture pipeline can't run under Jest).
const capturedHandlers: {
  onUpdate?: (event: unknown) => void;
  onEnd?: (event: unknown) => void;
  onFinalize?: (event: unknown, success: boolean) => void;
} = {};

jest.mock('react-native-gesture-handler', () => {
  const panBuilder: Record<string, jest.Mock> = {};
  panBuilder.enabled = jest.fn(() => panBuilder);
  panBuilder.onUpdate = jest.fn((fn) => {
    capturedHandlers.onUpdate = fn;
    return panBuilder;
  });
  panBuilder.onEnd = jest.fn((fn) => {
    capturedHandlers.onEnd = fn;
    return panBuilder;
  });
  panBuilder.onFinalize = jest.fn((fn) => {
    capturedHandlers.onFinalize = fn;
    return panBuilder;
  });
  return {
    Gesture: {
      Pan: jest.fn(() => panBuilder),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import {
  detectSwipeDirection,
  SWIPE_THRESHOLD_X,
  SWIPE_THRESHOLD_Y,
  VELOCITY_THRESHOLD,
  SCREEN_WIDTH,
} from '../useSwipeGesture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Just-above-threshold translation in x. */
const X_COMMIT = SWIPE_THRESHOLD_X + 1;
/** Just-above-threshold translation in y (negative = up). */
const Y_COMMIT = -(SWIPE_THRESHOLD_Y + 1);
/** Just-above-threshold velocity. */
const V_COMMIT = VELOCITY_THRESHOLD + 1;

/** Translation safely below all thresholds. */
const X_SMALL = SWIPE_THRESHOLD_X * 0.5;
const Y_SMALL = SWIPE_THRESHOLD_Y * 0.5;

// ---------------------------------------------------------------------------
// detectSwipeDirection — 7 direction cases
// ---------------------------------------------------------------------------

describe('detectSwipeDirection', () => {
  // Case 1: right swipe via translation
  it('returns "right" when translationX exceeds SWIPE_THRESHOLD_X', () => {
    expect(detectSwipeDirection(X_COMMIT, 0, 0, 0)).toBe('right');
  });

  // Case 2: left swipe via translation
  it('returns "left" when translationX is below negative SWIPE_THRESHOLD_X', () => {
    expect(detectSwipeDirection(-X_COMMIT, 0, 0, 0)).toBe('left');
  });

  // Case 3: up swipe via translation (translationY dominates over translationX)
  it('returns "up" when translationY crosses SWIPE_THRESHOLD_Y and Y dominates', () => {
    expect(detectSwipeDirection(0, Y_COMMIT, 0, 0)).toBe('up');
  });

  // Case 4: right swipe via velocity (fast flick, small translation)
  it('returns "right" when velocityX exceeds VELOCITY_THRESHOLD even with small translation', () => {
    expect(detectSwipeDirection(X_SMALL, 0, V_COMMIT, 0)).toBe('right');
  });

  // Case 5: left swipe via velocity
  it('returns "left" when velocityX is below negative VELOCITY_THRESHOLD even with small translation', () => {
    expect(detectSwipeDirection(-X_SMALL, 0, -V_COMMIT, 0)).toBe('left');
  });

  // Case 6: up swipe via velocity (fast upward flick)
  it('returns "up" when velocityY is below negative VELOCITY_THRESHOLD and Y dominates', () => {
    // Y translation must also dominate X translation for up priority to apply.
    expect(detectSwipeDirection(0, -Y_SMALL, 0, -V_COMMIT)).toBe('up');
  });

  // Case 7: null — below all thresholds
  it('returns null when translation and velocity are below all thresholds', () => {
    expect(detectSwipeDirection(X_SMALL, Y_SMALL, 0, 0)).toBeNull();
  });

  // Edge cases for robustness

  it('returns null for all-zero inputs', () => {
    expect(detectSwipeDirection(0, 0, 0, 0)).toBeNull();
  });

  it('prefers "up" over "right" when translationY dominates a diagonal up-right gesture', () => {
    // translationY is twice as large as translationX — up should win.
    const diagY = Y_COMMIT;
    const diagX = Math.abs(diagY) * 0.5;
    expect(detectSwipeDirection(diagX, diagY, 0, 0)).toBe('up');
  });

  it('returns "right" (not "up") when a diagonal gesture is more horizontal than vertical', () => {
    // translationX is twice as large as |translationY| — right should win.
    const bigX = X_COMMIT * 2;
    const smallY = Y_COMMIT; // still above up threshold, but X dominates
    expect(detectSwipeDirection(bigX, smallY, 0, 0)).toBe('right');
  });

  it('returns null at exactly the threshold boundary (not inclusive)', () => {
    // Exact threshold values should NOT commit.
    expect(detectSwipeDirection(SWIPE_THRESHOLD_X, 0, 0, 0)).toBeNull();
    expect(detectSwipeDirection(-SWIPE_THRESHOLD_X, 0, 0, 0)).toBeNull();
    expect(detectSwipeDirection(0, -SWIPE_THRESHOLD_Y, 0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Constants — sanity checks
// ---------------------------------------------------------------------------

describe('gesture constants', () => {
  it('SCREEN_WIDTH is the mocked window width (390)', () => {
    expect(SCREEN_WIDTH).toBe(390);
  });

  it('SWIPE_THRESHOLD_X is 30% of SCREEN_WIDTH', () => {
    expect(SWIPE_THRESHOLD_X).toBeCloseTo(SCREEN_WIDTH * 0.3);
  });

  it('SWIPE_THRESHOLD_Y is 120', () => {
    expect(SWIPE_THRESHOLD_Y).toBe(120);
  });

  it('VELOCITY_THRESHOLD is 500', () => {
    expect(VELOCITY_THRESHOLD).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// useSwipeGesture hook — shape test (mocked environment)
// ---------------------------------------------------------------------------

describe('useSwipeGesture', () => {
  it('returns gesture, animatedStyle, and resetCard', () => {
    // Import inside the describe so mocks are active.
    const { useSwipeGesture } = require('../useSwipeGesture');
    const onSwipe = jest.fn();
    const result = useSwipeGesture({ onSwipe });

    expect(result).toHaveProperty('gesture');
    expect(result).toHaveProperty('animatedStyle');
    expect(result).toHaveProperty('resetCard');
    expect(typeof result.resetCard).toBe('function');
  });

  it('resetCard() does not throw', () => {
    const { useSwipeGesture } = require('../useSwipeGesture');
    const { resetCard } = useSwipeGesture({ onSwipe: jest.fn() });
    expect(() => resetCard()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// useSwipeGesture — cancellation recenters the card (C2)
// ---------------------------------------------------------------------------

describe('useSwipeGesture cancellation (C2)', () => {
  const { withTiming } = require('react-native-reanimated');

  beforeEach(() => {
    capturedHandlers.onFinalize = undefined;
    (withTiming as jest.Mock).mockClear();
  });

  it('registers an onFinalize handler so cancellation is observed', () => {
    const { useSwipeGesture } = require('../useSwipeGesture');
    useSwipeGesture({ onSwipe: jest.fn() });
    expect(typeof capturedHandlers.onFinalize).toBe('function');
  });

  it('springs the card back to center when a gesture is cancelled (success=false)', () => {
    const { useSwipeGesture } = require('../useSwipeGesture');
    useSwipeGesture({ onSwipe: jest.fn() });
    // Clear the timing calls made during hook setup so only the cancellation
    // path's animations are counted.
    (withTiming as jest.Mock).mockClear();

    capturedHandlers.onFinalize!({ translationX: 80, translationY: 40 }, false);

    // translateX, translateY and rotation each eased back to 0.
    expect(withTiming).toHaveBeenCalledTimes(3);
    expect(withTiming).toHaveBeenCalledWith(0, expect.anything());
  });

  it('does nothing when the gesture finalized successfully (success=true)', () => {
    const { useSwipeGesture } = require('../useSwipeGesture');
    useSwipeGesture({ onSwipe: jest.fn() });
    (withTiming as jest.Mock).mockClear();

    capturedHandlers.onFinalize!({ translationX: 80, translationY: 40 }, true);

    expect(withTiming).not.toHaveBeenCalled();
  });
});
