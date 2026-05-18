# Phase 2: Swipe Core - Research

**Researched:** 2026-05-17
**Domain:** React Native gesture engine, Spotify remote playback control, Zustand persist, write queue patterns
**Confidence:** HIGH (gestures, Zustand, write queue) / MEDIUM (Spotify playback — two valid strategies with different tradeoffs)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-001 | `saveToLibrary()` on adapter — super like calls both addToPlaylist() and saveToLibrary() | SpotifyAdapter already implements this; PlaylistWriter orchestrates the parallel calls |
| REQ-002 | Swipe status enum: liked, super_liked, skipped, pending — backend schema already created in Phase 1 | Backend schema verified; SwipeEngine maps gestures/buttons to these four statuses |
| REQ-004 | Sessions table tracks swiped_count, liked_count, super_liked_count | Sessions table exists; SessionTracker updates counts via PATCH /sessions/:id |
| REQ-005 | Multi-destination: PlaylistWriter fires addToPlaylist() for all destinations in parallel | Parallel Promise.all() pattern; per-swipe destination snapshot stored in swipe_destinations |
| REQ-006 | Mid-session destination editor with three scopes | Zustand store models per-track override + session-default destinations |
</phase_requirements>

---

## Summary

Phase 2 builds the complete swipe loop on top of the Phase 1 adapter/auth foundation. The three highest-risk technical unknowns are: (1) how to play music without the Spotify Web Playback SDK, (2) how to implement swipe gestures correctly with Reanimated v3 + RNGH v2, and (3) how to keep PlaylistWriter writes from ever blocking the card stack.

**Spotify playback:** The Spotify Web Playback SDK is browser-only and does not run in React Native. The correct approach for this app is the Spotify Connect remote-control strategy — the app sends `PUT /me/player/play` with a track URI, which tells the user's existing Spotify native app (phone, desktop, speaker) to start playing. This requires Premium and that the user has an active Spotify device. For non-Premium users or users without an active device, a 30-second preview fallback via `expo-audio` handles playback using the `Track.previewUrl` field (already on the Track type). Both paths are hidden behind the adapter's `play()`, `pause()`, and `seek()` methods — no Spotify logic leaks into the UI.

**Gesture engine:** RNGH v2 (`GestureDetector` + `Gesture.Pan()`) with Reanimated v3 (`useSharedValue`, `useAnimatedStyle`, `withSpring`) is the established standard for Expo SDK 52. The card stack uses shared values for `translateX`, `translateY`, and `rotation`. Swipe is committed when velocity > 500 px/s OR translation > 30% of screen width. Below threshold: spring back to center. Above threshold: snap off-screen, then record swipe action.

**PlaylistWriter:** A simple in-memory async queue with exponential backoff handles all playlist write calls. `Promise.all()` fires one `addToPlaylist()` call per destination in parallel for each like. The queue is fire-and-forget from the swipe handler's perspective — the card advance does not await any write. Failed writes retry up to 5 times with jitter. This is sufficient for v1; a persistent job queue (e.g., `react-native-queue`) is deferred to Phase 5.

**Primary recommendation:** Use Spotify Connect remote control (PUT /me/player/play) as the primary playback strategy with expo-audio preview fallback. Install `react-native-gesture-handler ~2.22.1` and `react-native-reanimated ~3.16.x` via `npx expo install`. Use Zustand `persist` middleware with AsyncStorage for crash recovery. No new backend job queue libraries needed.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Track playback (play/pause/seek) | Adapter (SpotifyAdapter) | — | All Spotify calls are contained in the adapter; UI calls adapter methods only |
| Swipe gesture detection | Frontend (SwipeEngine component) | — | Native gesture thread; runs at 120fps via Reanimated worklets |
| Swipe state (queue, undo, session) | Client store (Zustand SwipeStore) | — | Local-first; backend sync is fire-and-forget |
| Playlist write (addToPlaylist) | Client (PlaylistWriter service) | Adapter | PlaylistWriter orchestrates parallel calls; SpotifyAdapter executes HTTP |
| Swipe sync to backend | Client (fire-and-forget) + Backend (POST /swipes) | — | Local state wins on conflict; backend is audit log |
| Session lifecycle | Client (SessionTracker) + Backend (sessions table) | — | Client opens/closes session; backend stores counts |
| Decide Later re-queue | Backend (pending status query) + Client (PlaylistResolver) | — | Cross-session persistence lives in DB; resolver injects pending tracks at front |
| Mid-session destination editor | Client (SwipeStore + modal UI) | Backend (retroactive batch update) | Editor modifies active session destinations; retroactive adds/removes hit backend |

---

## Standard Stack

### Core (new installs required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-native-gesture-handler | ~2.22.1 | Pan/tap gesture detection | Expo-bundled; runs on native thread via RNGH v2 API |
| react-native-reanimated | ~3.16.x | Shared values, spring animations | Expo-bundled; Reanimated v3 pairs with RNGH v2 |
| expo-audio | ~0.4.x | 30-second preview URL playback fallback | Official Expo library; replaces deprecated expo-av for audio |

### Already Installed (no change needed)

| Library | Current Version | Role in Phase 2 |
|---------|----------------|-----------------|
| zustand | ^5.0.0 | SwipeStore, SessionStore, write queue state |
| @react-native-async-storage/async-storage | 1.23.1 | Zustand persist storage backend |
| expo-secure-store | ~14.0.1 | Auth tokens (no change) |
| @supabase/supabase-js | ^2.46.0 | Backend calls via Supabase JWT (no change) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Spotify Connect remote control | expo-audio preview only | Preview = 30 sec max; Connect = full track but requires Premium + active device |
| expo-audio preview | react-native-track-player | RNTP needs custom dev client (breaks Expo Go); expo-audio works in managed workflow |
| In-memory write queue | react-native-queue | react-native-queue adds persistent job storage (useful for Phase 5 offline mode); overkill for Phase 2 |
| Gesture.Pan() | PanResponder | PanResponder is JS-thread only; RNGH v2 runs on native thread at 120fps |

**Installation:**
```bash
npx expo install react-native-gesture-handler react-native-reanimated expo-audio
```

**Version verification:**
```
react-native-gesture-handler@2.22.1  [VERIFIED: npm registry]
react-native-reanimated@3.16.7       [VERIFIED: npm registry]
expo-audio@0.4.9                     [VERIFIED: npm registry]
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| react-native-gesture-handler | npm | ~8 yrs | Very high | github.com/software-mansion/react-native-gesture-handler | OK (well-known) | Approved |
| react-native-reanimated | npm | ~7 yrs | Very high | github.com/software-mansion/react-native-reanimated | OK (well-known) | Approved |
| expo-audio | npm | ~2 yrs | High | github.com/expo/expo (monorepo) | OK (official Expo) | Approved |

*slopcheck was not run as a CLI tool (not installed in this environment). All three packages are confirmed via official documentation (Expo docs) and the npm registry, and are maintained by the organizations that own the primary platform (Software Mansion for RNGH/Reanimated, Expo for expo-audio). Risk of hallucination is negligible.*

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
User Gesture / Button Tap
         |
         v
  [SwipeEngine (RNGH v2 + Reanimated)]
    - translateX/Y shared values
    - velocity + threshold check
    - direction: left=skip, right=like, up=super_like
    - button: skip/like/super_like/decide_later/undo
         |
    Swipe committed
         |
    +---------+----------+-----------+
    |         |          |           |
    v         v          v           v
[SwipeStore] [PlaylistWriter] [SessionTracker] [BackendSync]
 (Zustand)   (fire+forget)    (fire+forget)    (fire+forget)
    |              |                |                |
    v              v                v                v
 local state  adapter.add     PATCH /sessions   POST /swipes
 advances     ToPlaylist()    counts            (batch OK)
 card stack   per destination

TrackPlayer (adapter.play/pause/seek)
    |
    v
[SpotifyAdapter.play()]
    |
    +-- Has active Spotify device? --YES--> PUT /me/player/play (Spotify Connect)
    |                                        play full track on native Spotify app
    +-- No active device / no Premium ---> expo-audio preview URL (30s)
    |                                        show "Open Spotify" prompt
    v
[SegmentNavigator]
    Tap left half  --> seek(-20s)
    Tap right half --> seek(+20s)
    (distinct from swipe directions — no conflict)
```

### Recommended Project Structure (new files for Phase 2)

```
src/
  swipe/
    SwipeEngine.tsx          # Card stack component; GestureDetector wrapper
    useSwipeGesture.ts       # Hook: pan gesture + spring animation logic
    SwipeCard.tsx            # Single card: art, title, artist, tap zones
    ButtonBar.tsx            # Skip / SuperLike / Like / DecideLater / Undo
    DestinationEditor.tsx    # Mid-session destination picker modal
  player/
    TrackPlayer.ts           # Adapter-backed play/pause/seek service
    SegmentNavigator.tsx     # Tap zone component (left/right half of card)
    usePreviewPlayer.ts      # expo-audio hook for preview URL fallback
  stores/
    swipeStore.ts            # Zustand: card queue, undo stack, active session
    [sessionStore.ts]        # Already exists — extend with session ID + counts
  services/
    PlaylistWriter.ts        # Parallel write queue with exponential backoff
    SessionTracker.ts        # Opens/closes sessions; patches counts
    BackendSync.ts           # Fire-and-forget POST /swipes; reconnect flush
backend/src/
  routes/
    swipes.ts                # POST /swipes (single + batch), GET /swipes?status=pending
    sessions.ts              # POST /sessions, PATCH /sessions/:id
```

### Pattern 1: Swipe Gesture (RNGH v2 + Reanimated v3)

**What:** A `GestureDetector` wraps the swipe card. `Gesture.Pan()` tracks translation and velocity. On end, if the card passes the commit threshold, it snaps off-screen; below threshold, it springs back.

**Key constants:**
```typescript
// Source: react-native-gesture-handler docs + community swipe card patterns [ASSUMED pattern]
const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD_X = SCREEN_WIDTH * 0.3;   // 30% of screen width
const SWIPE_THRESHOLD_Y = 120;                   // px upward for super like
const VELOCITY_THRESHOLD = 500;                  // px/s — fast flick commits regardless of distance

type SwipeDirection = 'left' | 'right' | 'up';

function detectSwipeDirection(
  translationX: number,
  translationY: number,
  velocityX: number,
  velocityY: number,
): SwipeDirection | null {
  const isUpSwipe =
    translationY < -SWIPE_THRESHOLD_Y || velocityY < -VELOCITY_THRESHOLD;
  const isRightSwipe =
    translationX > SWIPE_THRESHOLD_X || velocityX > VELOCITY_THRESHOLD;
  const isLeftSwipe =
    translationX < -SWIPE_THRESHOLD_X || velocityX < -VELOCITY_THRESHOLD;

  // Up takes priority (must check before horizontal)
  if (isUpSwipe && Math.abs(translationY) > Math.abs(translationX)) return 'up';
  if (isRightSwipe) return 'right';
  if (isLeftSwipe) return 'left';
  return null;
}
```

**Hook pattern:**
```typescript
// Source: Reanimated v3 docs pattern [ASSUMED code layout — verified API names]
import { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';

export function useSwipeGesture(onSwipe: (direction: SwipeDirection) => void) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotation = useSharedValue(0);

  const gesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
      // Subtle rotation: max ±15deg proportional to horizontal travel
      rotation.value = (event.translationX / SCREEN_WIDTH) * 15;
    })
    .onEnd((event) => {
      const direction = detectSwipeDirection(
        event.translationX,
        event.translationY,
        event.velocityX,
        event.velocityY,
      );

      if (direction) {
        // Snap off-screen in the commit direction
        const targetX =
          direction === 'left' ? -SCREEN_WIDTH * 1.5
          : direction === 'right' ? SCREEN_WIDTH * 1.5
          : 0;
        const targetY = direction === 'up' ? -800 : 0;

        translateX.value = withSpring(targetX, { velocity: event.velocityX, overshootClamping: true });
        translateY.value = withSpring(targetY, { velocity: event.velocityY, overshootClamping: true });
        runOnJS(onSwipe)(direction);
      } else {
        // Below threshold — spring back to center
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

  return { gesture, animatedStyle };
}
```

**Critical setup — GestureHandlerRootView must wrap the app root:**
```typescript
// app/_layout.tsx — ADD GestureHandlerRootView wrapper [VERIFIED: Expo docs]
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* existing Slot / auth check */}
    </GestureHandlerRootView>
  );
}
```

### Pattern 2: Spotify Playback — Remote Control via Spotify Connect

**What:** `SpotifyAdapter.play(trackUri)` sends `PUT /me/player/play` to the Spotify Web API. This tells the user's active Spotify native app (iPhone, Android, desktop) to play the track. No audio is streamed through MusicSwipe.

**Spotify Connect flow:**
```typescript
// Source: Spotify Web API Reference [VERIFIED: developer.spotify.com]
// Inside SpotifyAdapter — NOT callable from outside src/adapters/

async play(trackUri: string): Promise<void> {
  // 1. Check for active device
  const devicesData = await spotifyFetch<{ devices: SpotifyDevice[] }>(
    '/me/player/devices', {}, this.auth
  );
  const activeDevice = devicesData.devices.find(d => d.is_active);

  if (!activeDevice) {
    // No active device — surface NO_ACTIVE_DEVICE to the caller
    throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE);
  }

  // 2. Start playback on active device
  await spotifyFetch(
    `/me/player/play?device_id=${activeDevice.id}`,
    {
      method: 'PUT',
      body: JSON.stringify({ uris: [trackUri] }),
    },
    this.auth,
  );
}

async pause(): Promise<void> {
  await spotifyFetch('/me/player/pause', { method: 'PUT' }, this.auth);
}

async seek(positionMs: number): Promise<void> {
  await spotifyFetch(
    `/me/player/seek?position_ms=${positionMs}`,
    { method: 'PUT' },
    this.auth,
  );
}

async getCurrentPositionMs(): Promise<number> {
  const data = await spotifyFetch<{ progress_ms: number }>('/me/player', {}, this.auth);
  return data.progress_ms ?? 0;
}
```

**Required OAuth scopes (already requested in Phase 1):**
- `user-modify-playback-state` — play, pause, seek
- `user-read-playback-state` — read current position and active device

**Important:** This strategy requires Spotify Premium. `requiresPremium: true` is already set on `SpotifyAdapter.capabilities`. The `TrackPlayer` component reads this flag and shows a "Premium required" message for free users rather than attempting playback.

### Pattern 3: Preview URL Fallback (expo-audio)

**What:** When `NO_ACTIVE_DEVICE` is thrown, or when `Track.previewUrl` is non-null and the user is non-Premium, `TrackPlayer` falls back to playing the 30-second preview via `expo-audio`. [ASSUMED: not all tracks have preview URLs — handle null]

```typescript
// src/player/usePreviewPlayer.ts
import { useAudioPlayer } from 'expo-audio';

export function usePreviewPlayer(previewUrl: string | null) {
  // useAudioPlayer accepts null as "no source" [VERIFIED: expo-audio docs]
  const player = useAudioPlayer(previewUrl);

  return {
    play: () => previewUrl && player.play(),
    pause: () => player.pause(),
    seekTo: (seconds: number) => player.seekTo(seconds),
    currentTime: player.currentTime,    // seconds
    duration: player.duration,          // seconds
    isPlaying: player.playing,
    hasPreview: Boolean(previewUrl),
  };
}
```

**Null preview handling:** When `Track.previewUrl` is null AND no active Spotify device is available, show a "No preview available" state on the card. The user can still swipe (skip/like) — they just cannot hear the track.

### Pattern 4: Zustand SwipeStore with Persist

**What:** The SwipeStore holds all local swipe session state. The `persist` middleware writes to AsyncStorage so the session survives app kills.

```typescript
// src/stores/swipeStore.ts [ASSUMED code layout — verified Zustand API]
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '@/adapters/interface';

type SwipeStatus = 'liked' | 'super_liked' | 'skipped' | 'pending';

interface SwipeRecord {
  track: Track;
  status: SwipeStatus;
  destinationPlaylistIds: string[];
  swipedAt: string; // ISO timestamp
}

interface SwipeState {
  // Session identity
  sessionId: string | null;
  sourcePlaylistId: string | null;

  // Card queue
  queue: Track[];
  currentIndex: number;

  // Decide later — tracks re-queued for second pass in this session
  decideQueue: Track[];

  // Undo — last 1 swipe only
  undoStack: SwipeRecord[];

  // Active destinations — session default; overridable per-track
  activeDestinationIds: string[];

  // Swipes not yet synced to backend (fire-and-forget queue)
  pendingSyncSwipes: SwipeRecord[];
}

interface SwipeActions {
  initSession: (sessionId: string, sourcePlaylistId: string, queue: Track[], pendingTracks: Track[], destinationIds: string[]) => void;
  recordSwipe: (track: Track, status: SwipeStatus, destinationIds: string[]) => void;
  undo: () => SwipeRecord | null;
  setActiveDestinations: (destinationIds: string[]) => void;
  markSynced: (swipedAt: string) => void;
  clearSession: () => void;
}

export const useSwipeStore = create<SwipeState & SwipeActions>()(
  persist(
    (set, get) => ({
      sessionId: null,
      sourcePlaylistId: null,
      queue: [],
      currentIndex: 0,
      decideQueue: [],
      undoStack: [],
      activeDestinationIds: [],
      pendingSyncSwipes: [],

      initSession: (sessionId, sourcePlaylistId, queue, pendingTracks, destinationIds) =>
        set({
          sessionId,
          sourcePlaylistId,
          // Decide-later tracks go to the front, then remaining unswipped tracks
          queue: [...pendingTracks, ...queue],
          currentIndex: 0,
          decideQueue: [],
          undoStack: [],
          activeDestinationIds: destinationIds,
          pendingSyncSwipes: [],
        }),

      recordSwipe: (track, status, destinationIds) => {
        const record: SwipeRecord = {
          track,
          status,
          destinationIds,
          swipedAt: new Date().toISOString(),
        };
        set((state) => ({
          currentIndex: state.currentIndex + 1,
          undoStack: [record], // only keep last 1
          pendingSyncSwipes: [...state.pendingSyncSwipes, record],
          decideQueue:
            status === 'pending'
              ? [...state.decideQueue, track]
              : state.decideQueue,
        }));
      },

      undo: () => {
        const { undoStack, currentIndex } = get();
        if (undoStack.length === 0) return null;
        const [last] = undoStack;
        set((state) => ({
          currentIndex: Math.max(0, state.currentIndex - 1),
          undoStack: [],
          pendingSyncSwipes: state.pendingSyncSwipes.filter(
            (s) => s.swipedAt !== last.swipedAt,
          ),
          decideQueue:
            last.status === 'pending'
              ? state.decideQueue.filter((t) => t.id !== last.track.id)
              : state.decideQueue,
        }));
        return last;
      },

      setActiveDestinations: (destinationIds) =>
        set({ activeDestinationIds: destinationIds }),

      markSynced: (swipedAt) =>
        set((state) => ({
          pendingSyncSwipes: state.pendingSyncSwipes.filter(
            (s) => s.swipedAt !== swipedAt,
          ),
        })),

      clearSession: () =>
        set({
          sessionId: null,
          sourcePlaylistId: null,
          queue: [],
          currentIndex: 0,
          decideQueue: [],
          undoStack: [],
          activeDestinationIds: [],
          pendingSyncSwipes: [],
        }),
    }),
    {
      name: 'swipe-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist what is needed for crash recovery
      partialize: (state) => ({
        sessionId: state.sessionId,
        sourcePlaylistId: state.sourcePlaylistId,
        currentIndex: state.currentIndex,
        pendingSyncSwipes: state.pendingSyncSwipes,
        activeDestinationIds: state.activeDestinationIds,
      }),
    },
  ),
);
```

**Hydration guard:** Before entering the swipe screen, wait for the store to hydrate:
```typescript
// In the swipe screen component
const hasHydrated = useSwipeStore.persist.hasHydrated();
if (!hasHydrated) return <LoadingScreen />;
```

### Pattern 5: PlaylistWriter — Parallel Queue with Exponential Backoff

**What:** For each liked/super-liked track, `PlaylistWriter.write()` fires `addToPlaylist()` for every active destination in parallel. Failed calls retry with exponential backoff. This NEVER blocks the swipe UI.

```typescript
// src/services/PlaylistWriter.ts [ASSUMED code layout — verified pattern]
import type { MusicPlatformAdapter } from '@/adapters/interface';
import { PlatformError, PlatformErrorCode } from '@/adapters/interface';

interface WriteJob {
  trackId: string;
  playlistId: string;
  attempt: number;
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

async function executeWithBackoff(
  job: WriteJob,
  adapter: MusicPlatformAdapter,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await adapter.addToPlaylist(job.playlistId, job.trackId);
      return; // success
    } catch (error) {
      const isRateLimited =
        error instanceof PlatformError &&
        error.code === PlatformErrorCode.RATE_LIMITED;
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;

      if (isLastAttempt || !isRateLimited) {
        // Non-retryable or exhausted retries — log and give up silently
        console.warn('PlaylistWriter: giving up after', attempt + 1, 'attempts', error);
        return;
      }

      // Exponential backoff with jitter
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export class PlaylistWriter {
  constructor(private readonly adapter: MusicPlatformAdapter) {}

  // Fire-and-forget: do NOT await this from the swipe handler
  write(trackId: string, destinationPlaylistIds: string[]): void {
    const jobs = destinationPlaylistIds.map((playlistId) =>
      executeWithBackoff({ trackId, playlistId, attempt: 0 }, this.adapter),
    );
    // All destinations fire in parallel — intentionally not awaited
    Promise.all(jobs).catch(() => {
      // Outer catch is a safety net; errors handled per-job above
    });
  }

  // Super like: addToPlaylist for all destinations AND saveToLibrary
  superLike(trackId: string, destinationPlaylistIds: string[]): void {
    this.write(trackId, destinationPlaylistIds);
    // saveToLibrary is fire-and-forget too
    this.adapter.saveToLibrary(trackId).catch((err) => {
      console.warn('PlaylistWriter: saveToLibrary failed', err);
    });
  }
}
```

**The swipe handler pattern:**
```typescript
// In SwipeEngine — the swipe handler is synchronous from the store's perspective
const handleSwipe = (direction: SwipeDirection) => {
  const track = queue[currentIndex];
  const status = direction === 'right' ? 'liked'
                : direction === 'up' ? 'super_liked'
                : 'skipped';

  // 1. Record locally (instant — synchronous state update)
  recordSwipe(track, status, activeDestinationIds);

  // 2. Write to playlists (fire-and-forget — does NOT block card advance)
  if (status === 'liked') {
    playlistWriter.write(track.id, activeDestinationIds);
  } else if (status === 'super_liked') {
    playlistWriter.superLike(track.id, activeDestinationIds);
  }

  // 3. Sync to backend (fire-and-forget)
  backendSync.postSwipe({ track, status, destinationIds: activeDestinationIds, sessionId });
};
```

### Pattern 6: Backend Sync — Batch Endpoint + Reconnect Flush

**What:** `BackendSync.postSwipe()` sends swipe records to `POST /swipes` immediately. On reconnect or app resume, any `pendingSyncSwipes` from the Zustand store are flushed as a batch.

```typescript
// src/services/BackendSync.ts [ASSUMED code layout]

interface SwipePayload {
  sessionId: string;
  trackId: string;
  status: 'liked' | 'super_liked' | 'skipped' | 'pending';
  destinationPlaylistIds: string[];
  swipedAt: string;
}

export class BackendSync {
  constructor(private readonly supabaseToken: string, private readonly backendUrl: string) {}

  // Single swipe — fire and forget
  postSwipe(payload: SwipePayload): void {
    this.sendBatch([payload]).catch((err) =>
      console.warn('BackendSync: single swipe failed (will flush on reconnect)', err),
    );
  }

  // Flush all pending swipes on reconnect / app resume
  async flushPending(pendingSwipes: SwipePayload[]): Promise<void> {
    if (pendingSwipes.length === 0) return;
    await this.sendBatch(pendingSwipes);
  }

  private async sendBatch(swipes: SwipePayload[]): Promise<void> {
    const response = await fetch(`${this.backendUrl}/swipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.supabaseToken}`,
      },
      body: JSON.stringify({ swipes }),
    });
    if (!response.ok) throw new Error(`POST /swipes failed: ${response.status}`);
  }
}
```

**Backend `POST /swipes` accepts both single and batch:**
```typescript
// backend/src/routes/swipes.ts [ASSUMED code layout]
// Body: { swipes: SwipePayload[] }
// Single swipe: array of length 1
// Batch flush: array of N
// Upsert by (session_id, spotify_track_id) to handle duplicates from double-flush
```

**Reconnect trigger:** In the swipe screen, listen for `AppState` changes:
```typescript
// When app comes to foreground (AppState changes to 'active')
AppState.addEventListener('change', (nextState) => {
  if (nextState === 'active') {
    const pending = useSwipeStore.getState().pendingSyncSwipes;
    backendSync.flushPending(pending).then(() => {
      pending.forEach(s => markSynced(s.swipedAt));
    });
  }
});
```

### Pattern 7: App Kill / Resume Recovery

**What:** On crash + relaunch, the swipe screen reads the persisted Zustand state and resumes from `currentIndex`. The queue is NOT persisted (tracks re-fetched); only `sessionId`, `currentIndex`, `pendingSyncSwipes`, and `activeDestinationIds` are persisted.

**Recovery flow in the swipe screen:**
```typescript
// app/(app)/swipe/[playlistId].tsx

useEffect(() => {
  async function resumeOrInit() {
    await useSwipeStore.persist.rehydrate(); // ensure hydration complete

    const { sessionId, currentIndex, pendingSyncSwipes } = useSwipeStore.getState();

    // Flush any unsynced swipes from the previous session
    if (pendingSyncSwipes.length > 0) {
      backendSync.flushPending(pendingSyncSwipes).then(() =>
        pendingSyncSwipes.forEach(s => markSynced(s.swipedAt))
      );
    }

    // Re-fetch the queue — server gives pending tracks at front
    const { tracks } = await adapter.getPlaylistTracks(playlistId, currentIndex);

    if (sessionId) {
      // Resume existing session — start at currentIndex
      resumeSession(tracks);
    } else {
      // Fresh session — create on backend, init store
      const newSessionId = await sessionTracker.openSession(playlistId, destinationIds);
      initSession(newSessionId, playlistId, tracks, [], destinationIds);
    }
  }

  resumeOrInit();
}, []);
```

**What persists vs. re-fetches on resume:**

| Data | Strategy | Why |
|------|----------|-----|
| sessionId | Persisted (AsyncStorage) | Must link swipes to same session |
| currentIndex | Persisted | Resume at correct position in queue |
| pendingSyncSwipes | Persisted | Flush on next reconnect |
| activeDestinationIds | Persisted | Restore destination state |
| Queue (Track[]) | Re-fetched from adapter | Tracks too large to serialize; re-fetch is cheap |
| Player position | Not restored | User re-starts track from beginning after kill |

### Anti-Patterns to Avoid

- **Awaiting PlaylistWriter in the swipe handler:** PlaylistWriter.write() must be called without await. Awaiting it stalls the card advance.
- **Storing Track[] in AsyncStorage:** Full Track objects (with album art URLs etc.) are large. Persist only the `currentIndex` and re-fetch the queue on resume.
- **Calling Spotify endpoints directly from SwipeEngine or ButtonBar:** Everything Spotify goes through the adapter. This is the #1 architectural rule from CLAUDE.md.
- **Importing from src/adapters/spotify/ outside src/adapters/:** ESLint rule from Phase 1 will catch this, but be vigilant.
- **GestureDetector without GestureHandlerRootView ancestor:** Gestures silently fail. Wrap `app/_layout.tsx` root.
- **useSharedValue inside worklet without runOnJS for JS-side callbacks:** State updates (Zustand) must go through `runOnJS()` when called from a Reanimated worklet.
- **Single-device assumption for Spotify playback:** Users may have multiple devices. Always use `GET /me/player/devices` to find the active device; never hardcode a device ID.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Swipe gestures | PanResponder + Animated | RNGH v2 + Reanimated v3 | RNGH runs on the native thread; Animated is JS-thread and drops frames |
| Audio preview playback | Custom fetch + AudioContext | expo-audio (useAudioPlayer) | Handles audio session, background mode, interruptions, lifecycle |
| Spring physics | Custom easing curves | Reanimated `withSpring` | Physics params (stiffness, damping, mass) are tuned; hand-rolled versions feel wrong |
| Exponential backoff | `setTimeout` chain | Inline in PlaylistWriter (see pattern above) | Simple enough to inline for Phase 2; no library needed |
| Swipe card stack | Flatlist or manual z-index | 2-3 Animated.Views stacked with z-index | Only render 2-3 cards at once; React key cycling advances the stack |

**Key insight:** The gesture + animation stack (RNGH + Reanimated) handles all the hard work. The SwipeEngine's job is threshold logic and routing to the correct store action — not physics.

---

## Common Pitfalls

### Pitfall 1: Spotify "No Active Device" (403)

**What goes wrong:** `PUT /me/player/play` returns 403 with `NO_ACTIVE_DEVICE` even though the user has Spotify installed. The user must have the Spotify app open and in the foreground (or recently used) for it to register as an active device.

**Why it happens:** Spotify Connect requires an active session on a device. A Spotify app running in the background may not register. The user having Spotify installed is not sufficient.

**How to avoid:** Call `GET /me/player/devices` before every `play()` call. If no active device, throw `PlatformError(NO_ACTIVE_DEVICE)`. TrackPlayer catches this, falls back to preview URL, and shows "Open Spotify to enable full playback." This is already modeled in Phase 1 architecture (PlatformDeepLink).

**Warning signs:** 403 responses from `/me/player/play`; `devices.length === 0` from `/me/player/devices`.

### Pitfall 2: runOnJS Missing in Reanimated Worklets

**What goes wrong:** Calling `useSwipeStore.getState().recordSwipe(...)` inside a Reanimated `onEnd` callback crashes with "Tried to synchronously call function from a different thread."

**Why it happens:** Reanimated gesture callbacks run on the UI thread. Zustand state updates run on the JS thread. Direct JS calls from UI thread worklets are forbidden.

**How to avoid:** Always wrap JS-thread callbacks with `runOnJS()`:
```typescript
// Correct pattern
const dispatchSwipe = runOnJS((direction: SwipeDirection) => {
  onSwipe(direction); // this calls Zustand, which is JS-thread safe
});

// In onEnd:
.onEnd((event) => {
  if (shouldCommit) {
    dispatchSwipe(direction);
  }
});
```

### Pitfall 3: Double-Commit on Fast Swipe

**What goes wrong:** User swipes very fast; the gesture commits, animation starts, and then the second finger touch registers a new swipe before the card is off-screen. Two swipes fire for one card.

**Why it happens:** The card remains in the gesture tree while the snap animation plays.

**How to avoid:** Add a `isAnimating` shared value. Set it to `true` in `onEnd` when the direction is committed. Block new gesture starts while `isAnimating.value === true`:
```typescript
const isAnimating = useSharedValue(false);
const gesture = Gesture.Pan()
  .enabled(!isAnimating.value) // gate new gestures
  .onEnd((event) => {
    if (direction) {
      isAnimating.value = true;
      // ... snap animation ...
      // Reset isAnimating after animation completes in callback
    }
  });
```

### Pitfall 4: Preview URL Null Rate

**What goes wrong:** ~20-30% of Spotify tracks return `previewUrl: null`. The preview fallback silently fails because the hook receives null.

**Why it happens:** Spotify does not guarantee preview availability for all tracks, especially in certain markets.

**How to avoid:** The `Track` type already has `previewUrl: string | null`. The `TrackPlayer` component must handle the null case explicitly: show a "No preview" label on the card art but still allow swiping. Do not disable the swipe card when preview is null. [ASSUMED: percentage — verified that null values exist from Spotify Web API community reports]

### Pitfall 5: Zustand Hydration Race on First Render

**What goes wrong:** The swipe screen renders before AsyncStorage hydration completes. `sessionId` reads as null even though a session is persisted, and the app starts a new session instead of resuming.

**Why it happens:** Zustand persist with AsyncStorage is asynchronous. The store state is empty until the async read completes.

**How to avoid:** Check `useSwipeStore.persist.hasHydrated()` before reading session state. Display a loading indicator until hydration is confirmed. Alternatively, use the `onRehydrateStorage` callback to trigger session resume logic.

### Pitfall 6: Super Like Destination Snapshot Timing

**What goes wrong:** User taps "Super Like" after already having changed destinations mid-session with "This track" scope. The super like writes to the wrong playlists.

**Why it happens:** The "This track" override must be read at the moment of the swipe, not from the session default.

**How to avoid:** The swipe handler always receives the effective destination list at call time (per-track override if active, otherwise session default). The effective list is computed in the ButtonBar/SwipeEngine just before calling `handleSwipe`, not lazily from the store. The store records whatever list was passed.

---

## Code Examples

### Card Stack: 2-Card Render Approach

```typescript
// SwipeEngine renders only the top 2 cards at any time [ASSUMED code layout]
// Current card: index N (receives gesture)
// Next card: index N+1 (stationary, slightly scaled down)
// When N snaps off-screen: React key changes → N+1 becomes new top card

const currentTrack = queue[currentIndex];
const nextTrack = queue[currentIndex + 1];

return (
  <View style={styles.cardStack}>
    {nextTrack && (
      <SwipeCard track={nextTrack} style={styles.nextCard} />
    )}
    {currentTrack && (
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.currentCard, animatedStyle]}>
          <SwipeCard track={currentTrack} />
        </Animated.View>
      </GestureDetector>
    )}
  </View>
);
```

### SessionTracker: Open / Close / Count Update

```typescript
// src/services/SessionTracker.ts [ASSUMED code layout]
export class SessionTracker {
  constructor(private readonly backendUrl: string, private readonly token: string) {}

  async openSession(sourcePlaylistId: string): Promise<string> {
    const res = await fetch(`${this.backendUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ sourcePlaylistId }),
    });
    const data = await res.json();
    return data.id; // session UUID
  }

  // Fire-and-forget — call after each like/super-like
  async incrementCounts(sessionId: string, delta: { swiped?: number; liked?: number; superLiked?: number }): Promise<void> {
    await fetch(`${this.backendUrl}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(delta),
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await fetch(`${this.backendUrl}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    });
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PanResponder + Animated | RNGH v2 GestureDetector + Reanimated | RNGH v2 released 2022 | Native thread at 120fps; no JS bridge |
| expo-av for audio | expo-audio (useAudioPlayer hook) | SDK 51+ | Hook-based API; auto lifecycle management |
| Reanimated v2 useAnimatedGestureHandler | Reanimated v3 Gesture.Pan().onUpdate | Reanimated v3 (2023) | Simpler API; callbacks are auto-workletized |
| Single destination per swipe | swipe_destinations join table (multi) | Phase 1 schema design | Each swipe records all destination IDs |

**Deprecated/outdated:**
- `useAnimatedGestureHandler`: Reanimated v2 API. Replaced by `Gesture.Pan().onUpdate()` in v3.
- `expo-av Audio.Sound.createAsync()`: Still works but expo-audio's hook API is the recommended path for new code.
- `PanGestureHandler` component (RNGH legacy): Use `GestureDetector` + `Gesture.Pan()` in RNGH v2.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | expo-audio ~0.4.x is compatible with Expo SDK 52 (project uses ~52.0.0) | Standard Stack | Wrong version installed; runtime crash. Mitigation: run `npx expo install expo-audio` which auto-selects the correct version |
| A2 | `preview_url` is null for ~20-30% of tracks | Pitfall 4 | Actual rate may be higher; affects how prominently the "no preview" state must be designed |
| A3 | SwipeStore code layout (Zustand store structure) | Pattern 4 | Architectural — planner may adjust store shape; the Zustand APIs used are verified |
| A4 | Backend route code layout (swipes.ts, sessions.ts) | Pattern 6, Code Examples | Planner may structure routes differently; the schema (Phase 1) is verified |
| A5 | PlaylistWriter code layout (executeWithBackoff) | Pattern 5 | Implementation detail — planner may factor differently |
| A6 | `GET /me/player/devices` → find `is_active: true` device before every play() | Pattern 2 | Adds one API call per track play; may increase latency. Alternative: cache device ID for session duration |

---

## Open Questions

1. **Expo SDK 52 vs expo-audio version alignment**
   - What we know: expo-audio's `sdk-51` tag is `0.1.0`; latest is `55.0.14`. The 0.4.x range was likely for SDK 52.
   - What's unclear: exact `~X.Y.Z` version string for SDK 52.
   - Recommendation: Run `npx expo install expo-audio` — this resolves the correct version automatically. Do not pin a specific version manually.

2. **Device caching for Spotify Connect**
   - What we know: `GET /me/player/devices` adds a round-trip before every track play.
   - What's unclear: Whether this causes perceptible latency at track-switch time.
   - Recommendation: Cache the active device ID for the session duration. Invalidate cache on `NO_ACTIVE_DEVICE` error and re-fetch.

3. **Mid-session retroactive "Entire session" add/remove backend behavior**
   - What we know: Adding a destination to all session-liked tracks is a batch `addToPlaylist()` call. Removing prompts user.
   - What's unclear: Whether the batch add should go through PlaylistWriter (fire-and-forget) or block until complete (user sees progress).
   - Recommendation: For adds: fire-and-forget through PlaylistWriter. For removes: show loading indicator, await completion, then dismiss modal — destructive actions should be confirmed with feedback.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Spotify Premium account | Spotify Connect playback | Not verifiable in CI | — | expo-audio preview URL |
| Active Spotify device | PUT /me/player/play | Runtime only | — | expo-audio + PlatformDeepLink prompt |
| react-native-gesture-handler | SwipeEngine | Not installed yet | — | Must install via `npx expo install` |
| react-native-reanimated | SwipeEngine animations | Not installed yet | — | Must install via `npx expo install` |
| expo-audio | Preview URL fallback | Not installed yet | — | Must install via `npx expo install` |
| Backend (Express) | POST /swipes, POST /sessions | Running (Phase 1 complete) | Phase 1 verified | — |
| AsyncStorage | Zustand persist | 1.23.1 (installed) | 1.23.1 | — |

**Missing dependencies with no fallback:**
- react-native-gesture-handler, react-native-reanimated, expo-audio — all must be installed before any Phase 2 implementation begins. Single install command: `npx expo install react-native-gesture-handler react-native-reanimated expo-audio`

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7 + jest-expo ~52.0 |
| Config file | jest block in package.json (exists) |
| Quick run command | `npx jest --watchAll=false --testPathPattern="swipe"` |
| Full suite command | `npx jest --watchAll=false` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-001 | superLike() calls saveToLibrary() AND addToPlaylist() for all destinations | unit | `npx jest --testPathPattern="PlaylistWriter"` | No — Wave 0 |
| REQ-002 | recordSwipe() stores correct status; pending tracks enter decideQueue | unit | `npx jest --testPathPattern="swipeStore"` | No — Wave 0 |
| REQ-004 | openSession() creates session; closeSession() sets endedAt | unit (mock fetch) | `npx jest --testPathPattern="SessionTracker"` | No — Wave 0 |
| REQ-005 | PlaylistWriter.write() fires addToPlaylist N times (one per destination) in parallel | unit | `npx jest --testPathPattern="PlaylistWriter"` | No — Wave 0 |
| REQ-006 | setActiveDestinations() updates store; swipe records the overridden destination list | unit | `npx jest --testPathPattern="swipeStore"` | No — Wave 0 |
| (all) | Gesture threshold: translation > 30% width → swipe committed | unit (pure function) | `npx jest --testPathPattern="useSwipeGesture"` | No — Wave 0 |
| (all) | Undo: last swipe record removed from pendingSyncSwipes and decideQueue | unit | `npx jest --testPathPattern="swipeStore"` | No — Wave 0 |
| (all) | Retry: RATE_LIMITED error triggers backoff; non-retryable error fails silently | unit | `npx jest --testPathPattern="PlaylistWriter"` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `npx jest --watchAll=false --testPathPattern="(swipeStore|PlaylistWriter|SessionTracker)"`
- **Per wave merge:** `npx jest --watchAll=false`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

All test files need creating. Minimum set:

- [ ] `src/swipe/__tests__/swipeGesture.test.ts` — threshold and direction detection (pure functions; no RNGH/Reanimated needed)
- [ ] `src/stores/__tests__/swipeStore.test.ts` — recordSwipe, undo, setActiveDestinations, persist partialize
- [ ] `src/services/__tests__/PlaylistWriter.test.ts` — parallel writes, retry on RATE_LIMITED, super like
- [ ] `src/services/__tests__/SessionTracker.test.ts` — openSession, closeSession, incrementCounts
- [ ] `src/services/__tests__/BackendSync.test.ts` — postSwipe, flushPending batch

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase JWT on all /swipes and /sessions endpoints (already in Phase 1 middleware) |
| V3 Session Management | yes | sessionId is a server-generated UUID; not user-supplied |
| V4 Access Control | yes | Backend must verify session.user_id === req.userId before writing swipes |
| V5 Input Validation | yes | Validate status enum values server-side; reject unknown statuses |
| V6 Cryptography | no | No new crypto; Spotify tokens remain in SecureStore (Phase 1) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User A writes swipes to User B's session | Spoofing | Verify session.user_id === req.userId in POST /swipes middleware |
| Invalid status value injected in POST /swipes | Tampering | Server-side CHECK constraint already in schema; also validate in route handler |
| Replay of POST /swipes batch | Repudiation | Upsert by (session_id, spotify_track_id) — idempotent; duplicates ignored |
| Backend receives Spotify tokens | Information Disclosure | D-11 from Phase 1: backend NEVER receives Spotify tokens. All Spotify calls stay on device. |

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: developer.spotify.com] — PUT /me/player/play requires Premium; controls existing Spotify native app via Spotify Connect; requires `user-modify-playback-state` scope; device_id from GET /me/player/devices
- [VERIFIED: npm registry] — react-native-gesture-handler@2.22.1 (software-mansion), react-native-reanimated@3.16.7 (software-mansion), expo-audio@0.4.9 (expo)
- [VERIFIED: expo docs] — expo-audio useAudioPlayer hook: `play()`, `pause()`, `seekTo(seconds)`, `currentTime`, `duration`, `playing`; accepts null source
- [VERIFIED: expo docs] — GestureHandlerRootView must wrap the app root in `app/_layout.tsx`
- [VERIFIED: reanimated docs] — withSpring config: stiffness, damping, mass, velocity, overshootClamping; Gesture.Pan() onUpdate/onEnd; useSharedValue, useAnimatedStyle
- [CITED: zustand.docs.pmnd.rs] — persist middleware with createJSONStorage(AsyncStorage), partialize option, hasHydrated()

### Secondary (MEDIUM confidence)

- [CITED: community.spotify.com] — Spotify Web Playback SDK does not run in React Native; WebView approach has audio-stopping-on-lock issues
- [CITED: GitHub issues spotify/web-api] — preview_url can be null for a significant portion of tracks

### Tertiary (LOW confidence)

- [ASSUMED] — ~20-30% preview_url null rate (rough estimate from community reports; actual rate varies by market and playlist)
- [ASSUMED] — All code layout patterns (SwipeStore shape, PlaylistWriter structure, SessionTracker API) — APIs used are verified; file organization is proposed

---

## Metadata

**Confidence breakdown:**
- Spotify playback strategy: MEDIUM — two valid approaches (Connect vs. preview); Connect confirmed as correct for premium users; preview fallback confirmed via expo-audio docs
- Gesture/animation stack: HIGH — RNGH v2 + Reanimated v3 verified as Expo SDK 52 standard; API shapes confirmed from official docs
- Zustand persist pattern: HIGH — official Zustand docs; package version verified
- PlaylistWriter queue: HIGH — standard exponential backoff pattern; no library needed
- Code layout/structure: LOW-MEDIUM — verified API calls; file organization is proposed (Claude's discretion)

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (30 days — stable libraries)
