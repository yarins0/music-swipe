---
id: 02-PLAN-02
title: SwipeStore (Zustand persist) + useSwipeGesture hook
wave: 1
depends_on: []
files_modified:
  - src/stores/swipeStore.ts
  - src/swipe/useSwipeGesture.ts
  - src/swipe/__tests__/swipeGesture.test.ts
  - src/stores/__tests__/swipeStore.test.ts
autonomous: true
requirements_addressed:
  - REQ-002
  - REQ-005
  - REQ-006
---

# Plan 02: SwipeStore + Gesture Hook

## Objective

Create the Zustand swipe store with AsyncStorage persistence (crash-recovery-ready) and the `useSwipeGesture` hook that implements the RNGH v2 + Reanimated v3 pan gesture with threshold-commit logic. These two are independent from each other and from Plan 01's dependency install — they can be authored in parallel but will need Plan 01 to run before being exercised on a device.

Purpose: The store is the source of truth for all swipe state (queue, undo, active destinations, pending sync). The gesture hook is the only place that interprets pan events and fires the swipe callback.

Output: `src/stores/swipeStore.ts`, `src/swipe/useSwipeGesture.ts`, and unit tests for both.

## Tasks

<task id="T02-02-1" tdd="true">
<title>Task 1: Create SwipeStore with Zustand persist</title>

<read_first>
- src/stores/sessionStore.ts (existing Zustand store pattern — match the interface/actions split and create() shape exactly)
- src/stores/authStore.ts (look for any established store conventions — naming, middleware order)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 4 — full SwipeStore code including persist config and partialize)
- .planning/notes/decide-later-session-persistence.md (Decide Later behavior — how pending tracks enter decideQueue)
- .planning/notes/multi-destination-playlists.md (per-track destination override — activeDestinationIds in store)
- .planning/REQUIREMENTS.md (REQ-002 status enum, REQ-006 mid-session destination override)
- src/adapters/interface.ts (Track interface — swipeStore.ts imports Track from here)
</read_first>

<behavior>
- recordSwipe(track, 'liked', ['pl-1']) → currentIndex increments by 1, undoStack holds the record, pendingSyncSwipes gains one entry
- recordSwipe(track, 'pending', ['pl-1']) → decideQueue gains the track in addition to the above
- recordSwipe(track, 'super_liked', ['pl-1']) → currentIndex increments, decideQueue unchanged
- undo() when undoStack has a 'pending' record → currentIndex decrements, undoStack cleared, decideQueue loses the track, pendingSyncSwipes loses the record
- undo() when undoStack is empty → returns null, no state change
- setActiveDestinations(['pl-2']) → activeDestinationIds is ['pl-2']
- markSynced(swipedAt) → removes matching record from pendingSyncSwipes only
- initSession() → queue is pendingTracks prepended to tracks, currentIndex reset to 0, decideQueue cleared
- clearSession() → all state reset to initial values
- persist partialize: only sessionId, sourcePlaylistId, currentIndex, pendingSyncSwipes, activeDestinationIds are persisted (queue and decideQueue are NOT persisted)
</behavior>

<action>
Create src/stores/swipeStore.ts following the exact pattern from 02-RESEARCH.md Pattern 4.

Key implementation points:
- Import Track from '@/adapters/interface' (not from '@/adapters/spotify/')
- SwipeStatus type: 'liked' | 'super_liked' | 'skipped' | 'pending'
- SwipeRecord interface: { track: Track; status: SwipeStatus; destinationPlaylistIds: string[]; swipedAt: string }
- SwipeState: sessionId, sourcePlaylistId, queue (Track[]), currentIndex, decideQueue (Track[]), undoStack (SwipeRecord[] — max 1), activeDestinationIds (string[]), pendingSyncSwipes (SwipeRecord[])
- SwipeActions: initSession, recordSwipe, undo, setActiveDestinations, markSynced, clearSession
- Use persist middleware with createJSONStorage(() => AsyncStorage) and partialize to include ONLY: sessionId, sourcePlaylistId, currentIndex, pendingSyncSwipes, activeDestinationIds — do NOT persist queue or decideQueue (too large)
- persist storage name: 'swipe-store'

In recordSwipe, capture destinationPlaylistIds in the SwipeRecord. The caller passes the effective list (per-track override or session default) — the store records whatever is passed.

In undo, when the undone record had status 'pending', remove the track from decideQueue by track.id.

Create src/stores/__tests__/swipeStore.test.ts with tests covering all behaviors listed above. Use jest.mock for '@react-native-async-storage/async-storage' (returns in-memory object). Import useSwipeStore and call actions directly on getState().
</action>

<verify>
<automated>npx jest --watchAll=false --testPathPattern="swipeStore"</automated>
</verify>

<done>
- src/stores/swipeStore.ts exists and exports useSwipeStore
- All behavior tests pass
- persist config includes partialize that excludes queue and decideQueue
- `npx tsc --noEmit` exits 0
</done>
</task>

<task id="T02-02-2" tdd="true">
<title>Task 2: Create useSwipeGesture hook + direction detection tests</title>

<read_first>
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 1 — complete useSwipeGesture hook, SCREEN_WIDTH constants, detectSwipeDirection function; Pitfall 2 — runOnJS; Pitfall 3 — double-commit prevention with isAnimating)
- .planning/notes/button-bar-gesture-design.md (gesture mapping: left=skip, right=like, up=super_like)
</read_first>

<behavior>
detectSwipeDirection tests (pure function, no RNGH/Reanimated needed):
- translationX=200, translationY=0, velocityX=0, velocityY=0 → 'right' (200 > 30% of 390px screen width ≈ 117px)
- translationX=-200, translationY=0, velocityX=0, velocityY=0 → 'left'
- translationX=0, translationY=-150, velocityX=0, velocityY=0 → 'up' (150 > SWIPE_THRESHOLD_Y=120)
- translationX=50, translationY=-150, velocityX=0, velocityY=0 → 'up' (up priority when |translationY| > |translationX|)
- translationX=50, translationY=-50, velocityX=600, velocityY=0 → 'right' (velocity > 500)
- translationX=0, translationY=0, velocityX=0, velocityY=-600 → 'up' (velocityY < -500)
- translationX=50, translationY=-10, velocityX=0, velocityY=0 → null (below all thresholds)
</behavior>

<action>
Create src/swipe/useSwipeGesture.ts.

Extract detectSwipeDirection as a named export (so it can be unit-tested independently):

```
export type SwipeDirection = 'left' | 'right' | 'up';

export const SCREEN_WIDTH = Dimensions.get('window').width;
export const SWIPE_THRESHOLD_X = SCREEN_WIDTH * 0.3;
export const SWIPE_THRESHOLD_Y = 120;
export const VELOCITY_THRESHOLD = 500;

export function detectSwipeDirection(
  translationX: number,
  translationY: number,
  velocityX: number,
  velocityY: number,
): SwipeDirection | null
```

The hook signature:
```
export function useSwipeGesture(onSwipe: (direction: SwipeDirection) => void): {
  gesture: ReturnType<typeof Gesture.Pan>;
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  resetCard: () => void;
}
```

Implementation:
- translateX, translateY, rotation, isAnimating are useSharedValue(0) / useSharedValue(false)
- Gesture.Pan().onUpdate sets translateX, translateY, rotation (max ±15deg proportional to translationX/SCREEN_WIDTH)
- Gesture.Pan().enabled() receives !isAnimating.value to block double-commit (Pitfall 3)
- In .onEnd: call detectSwipeDirection; if direction → set isAnimating.value = true, snap off-screen with withSpring({overshootClamping: true}), call runOnJS(onSwipe)(direction); else spring back to center
- resetCard() sets translateX, translateY, rotation, isAnimating all back to 0/false — called by SwipeEngine after the card is removed from the stack
- animatedStyle uses useAnimatedStyle with transform: [translateX, translateY, rotate]

Snap targets: left → translateX = -SCREEN_WIDTH * 1.5; right → translateX = SCREEN_WIDTH * 1.5; up → translateY = -800, translateX = 0.

Create src/swipe/__tests__/swipeGesture.test.ts with tests for detectSwipeDirection using the cases listed in behavior. Do NOT test the hook directly (RNGH/Reanimated require a device); test only the exported pure function.
</action>

<verify>
<automated>npx jest --watchAll=false --testPathPattern="swipeGesture"</automated>
</verify>

<done>
- src/swipe/useSwipeGesture.ts exists and exports useSwipeGesture, detectSwipeDirection, SwipeDirection, and the threshold constants
- All direction detection tests pass
- `npx tsc --noEmit` exits 0
</done>
</task>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| AsyncStorage (persist) | Swipe state written to device storage; read on resume |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-02-01 | Tampering | swipeStore AsyncStorage (persisted state) | accept | State is local to device; no server trust boundary crossed here. AsyncStorage contents are session recovery data only (sessionId, currentIndex, pendingSyncSwipes) — no sensitive credentials |
| T-02-02-02 | Information Disclosure | Track[] in pendingSyncSwipes | accept | Track metadata (title, artist, IDs) is persisted; no PII. Destination playlist IDs are also persisted — acceptable for crash recovery |
</threat_model>

<verification>
- `npx jest --watchAll=false --testPathPattern="(swipeStore|swipeGesture)"` all pass
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
</verification>

<success_criteria>
- SwipeStore models all swipe session state: queue position, undo, active destinations, pending sync queue, decide-later tracks
- Persist config correctly excludes large arrays (queue, decideQueue) from AsyncStorage
- detectSwipeDirection correctly prioritizes up over horizontal, and velocity over translation
- runOnJS is used in onEnd for the onSwipe callback (so Reanimated worklet can call JS-thread Zustand)
</success_criteria>

<output>
Create `.planning/phases/02-swipe-core/02-02-SUMMARY.md` when done
</output>
