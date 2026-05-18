---
id: 02-PLAN-07
title: Swipe screen — session init, queue load, pending injection, kill/resume recovery
wave: 3
depends_on:
  - 02-PLAN-02
  - 02-PLAN-03
  - 02-PLAN-04
  - 02-PLAN-05
  - 02-PLAN-06
files_modified:
  - app/(app)/swipe/[playlistId].tsx
autonomous: true
requirements_addressed:
  - REQ-001
  - REQ-002
  - REQ-004
  - REQ-005
  - REQ-006
---

# Plan 07: Swipe Screen

## Objective

Create the Expo Router dynamic route `app/(app)/swipe/[playlistId].tsx` — the entry point for a swipe session. It is responsible for: hydrating the store, fetching pending tracks from the backend, fetching the playlist queue from the adapter, creating or resuming a backend session, and handing off to SwipeEngine. It also handles AppState reconnect flush and mid-session kill/resume recovery.

Purpose: SwipeEngine is stateless from the perspective of session lifecycle — it only consumes the initialized store. The screen is the sole owner of session lifecycle.

Output: A single Expo Router screen file that wires everything together.

## Interfaces

From prior plans — extracted contracts the executor needs:

```typescript
// src/stores/swipeStore.ts — store hydration and session init
useSwipeStore.persist.hasHydrated(): boolean
useSwipeStore.getState().sessionId: string | null
useSwipeStore.getState().currentIndex: number
useSwipeStore.getState().pendingSyncSwipes: SwipeRecord[]
useSwipeStore().initSession(sessionId, sourcePlaylistId, queue, pendingTracks, destinationIds): void
useSwipeStore().clearSession(): void
useSwipeStore().markSynced(swipedAt): void
useSwipeStore().setActiveDestinations(ids): void

// src/adapters/interface.ts — adapter methods used by the screen
adapter.getPlaylistTracks(playlistId, offset, limit): Promise<{ tracks: Track[]; total: number }>
adapter.removeFromPlaylist(playlistId: string, trackId: string): Promise<void>

// src/services/SessionTracker.ts
sessionTracker.openSession(sourcePlaylistId): Promise<string>
sessionTracker.closeSession(sessionId): void

// src/services/BackendSync.ts
backendSync.flushPending(pendingSwipes): Promise<void>
backendSync.postSwipeDestinationUpdate(swipeIds: string[], destinationPlaylistId: string): Promise<void>

// Expo Router params
const { playlistId } = useLocalSearchParams<{ playlistId: string }>();

// src/stores/sessionStore.ts (Phase 1 — destinationPlaylistIds are here)
useSessionStore().destinationPlaylistIds: string[]

// Backend — GET /swipes?status=pending&source_playlist_id=X
// Returns: { swipes: [{ spotify_track_id: string; title: string; artist: string; albumArtUrl: string; previewUrl: string | null }] }
// The backend JOINs the tracks table so all metadata is included — no extra adapter call needed
```

## Tasks

<task id="T02-07-1">
<title>Task 1: Swipe screen — session init, pending track injection, kill/resume, AppState flush</title>

<read_first>
- app/(app)/swipe (check if directory exists — create if not)
- app/(app) directory structure (how other screens are structured to match conventions)
- src/stores/swipeStore.ts (hasHydrated, getState(), initSession, clearSession, markSynced)
- src/stores/sessionStore.ts (destinationPlaylistIds — set by playlist picker in Phase 1)
- src/stores/authStore.ts (to get supabaseToken and backendUrl for service instantiation)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 7 — App Kill/Resume Recovery flow; Pattern 6 — AppState reconnect flush; Pitfall 5 — Zustand hydration race)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Open Question 3 — retroactive "Entire session" add/remove: adds fire-and-forget via PlaylistWriter; removes show loading indicator and await completion)
- src/swipe/SwipeEngine.tsx (props interface — what the screen must provide)
- CLAUDE.md (architectural rules — no Spotify-specific code outside adapters/)
</read_first>

<action>
Create app/(app)/swipe/[playlistId].tsx.

The screen is a functional component using Expo Router's useLocalSearchParams for playlistId.

Phase ordering within the screen useEffect:

Step 1 — Hydration guard:
Wait for useSwipeStore.persist.hasHydrated() before doing anything. Show a LoadingScreen (ActivityIndicator) until hydration completes. Use the onRehydrateStorage callback or a short polling effect — whichever is cleaner.

Step 2 — Flush any pending swipes from previous session:
Read pendingSyncSwipes from the store. If non-empty, call backendSync.flushPending(pendingSyncSwipes) then call markSynced for each flushed record.

Step 3 — Fetch pending tracks for this playlist from backend:
Call GET /swipes?status=pending&source_playlist_id={playlistId} with the supabaseToken. The backend response includes full track metadata (title, artist, albumArtUrl, previewUrl) via a JOIN with the tracks table — map each response item directly to a Track object without making any additional adapter calls. Do NOT use cross-referencing with the full playlist fetch below as a substitute — that approach silently drops pending tracks at positions beyond the first page of the playlist.

Step 4 — Fetch playlist queue from adapter:
Call adapter.getPlaylistTracks(playlistId). This is the full queue. Exclude tracks already swiped in the active session (use currentIndex offset). If a session is being resumed (store has sessionId and currentIndex > 0), slice the queue starting at currentIndex.

Step 5 — Resume vs. fresh session:
- If store.sessionId is non-null (crash recovery): call initSession(store.sessionId, playlistId, queue, pendingTracks, store.activeDestinationIds). This resumes without creating a new backend session.
- If store.sessionId is null (fresh start): call sessionTracker.openSession(playlistId), then initSession(newSessionId, playlistId, queue, pendingTracks, destinationPlaylistIds from sessionStore).

Service instantiation:
The screen instantiates all services with values from authStore (supabaseToken, backendUrl) and the adapter from context/provider. These are created once in a useRef to avoid recreation on re-render:
- playlistWriter = useRef(new PlaylistWriter(adapter))
- sessionTracker = useRef(new SessionTracker(backendUrl, token))
- backendSync = useRef(new BackendSync(backendUrl, token))
- trackPlayer = useRef(new TrackPlayer(adapter))

AppState listener (reconnect flush):
Register AppState.addEventListener('change', ...) in a useEffect with cleanup. When nextState === 'active': flush pending swipes (same as Step 2). Clean up listener on unmount.

Session close on unmount / navigation exit:
In the return function of the session init useEffect, call sessionTracker.closeSession(sessionId) and clearSession() from the store.

onSessionEnd callback (passed to SwipeEngine):
When SwipeEngine calls onSessionEnd (queue exhausted), close the session and navigate back to the playlist picker.

DestinationEditor integration in SwipeEngine — onEntireSession handler:
The screen passes availablePlaylists (fetched from adapter.getUserPlaylists() — filter isOwned) to SwipeEngine. SwipeEngine passes it through to DestinationEditor.

The screen handles the onEntireSession callback from DestinationEditor with the following logic. Read swipeStore history to get all session-liked records: filter by status === 'liked' or status === 'super_liked'.

Retroactive ADD path (new destination selected for entire session):
- For each liked SwipeRecord, call playlistWriter.current.add(newDestinationPlaylistId, track) — fire-and-forget (do not await; PlaylistWriter queues and retries internally).
- Call backendSync.current.postSwipeDestinationUpdate(likedSwipeIds, newDestinationPlaylistId) to update swipe_destinations records on the backend — also fire-and-forget.
- Dismiss the modal immediately; PlaylistWriter handles retry on failure.

Retroactive REMOVE path (previously active destination removed for entire session):
- Show a loading indicator inside the DestinationEditor modal (set a local isRemoving state to true) before starting removal — do not dismiss the modal yet.
- For each liked SwipeRecord, await adapter.removeFromPlaylist(removedPlaylistId, track.id). This is a destructive action; it must complete before the modal is dismissed. Process removals sequentially (for...of with await) to avoid overwhelming the Spotify rate limiter.
- After all removals complete, call backendSync.current.postSwipeDestinationUpdate(likedSwipeIds, removedPlaylistId) with a flag or separate endpoint indicating removal — update as appropriate to the backend API contract established in Plan 03.
- Set isRemoving to false and dismiss the modal.
- If any removeFromPlaylist call throws (PlatformError.RATE_LIMITED or network error), catch the error, dismiss the modal, and display a non-blocking toast: "Some tracks could not be removed — try again". Do not leave the modal in a stuck loading state on error.

Per-track override state:
Managed in SwipeEngine as local component state (not in the store). The screen does not manage it.
</action>

<verify>
  <automated>npx tsc --noEmit && npx expo lint</automated>
</verify>

<done>
- app/(app)/swipe/[playlistId].tsx exists as a valid Expo Router screen (default export is a React component)
- Screen shows ActivityIndicator until store is hydrated and queue is fetched
- On fresh start: POST /sessions is called before SwipeEngine renders (confirmed by reading useEffect logic)
- On crash resume: sessionId from persisted store is reused without calling POST /sessions again
- AppState 'active' event triggers flushPending
- Session is closed (PATCH /sessions/:id with endedAt) on screen unmount
- Pending tracks from GET /swipes are mapped directly from backend response metadata — no cross-reference with playlist fetch
- DestinationEditor's retroactive remove triggers adapter.removeFromPlaylist for each session-liked track; modal shows a loading indicator during removal and dismisses only on completion (or error); swipe_destinations records are updated on the backend via backendSync.postSwipeDestinationUpdate; errors surface as a non-blocking toast
- No import from src/adapters/spotify/ in the screen file
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
</done>
</task>

<task id="T02-07-2" type="checkpoint:human-verify" gate="blocking">
<title>Task 2: End-to-end swipe session smoke test</title>

<what-built>
All Phase 2 components are now wired together:
- Dependencies installed (Plan 01)
- SwipeStore and gesture hook (Plan 02)
- Backend /sessions and /swipes routes (Plan 03)
- SpotifyAdapter playback + TrackPlayer (Plan 04)
- PlaylistWriter, SessionTracker, BackendSync services (Plan 05)
- SwipeEngine, SwipeCard, ButtonBar, DestinationEditor (Plan 06)
- Swipe screen with session lifecycle (Plan 07)
</what-built>

<how-to-verify>
1. Run `npx tsc --noEmit` — must exit 0
2. Run `npx jest --watchAll=false` — all tests must pass
3. Run `npx expo lint` — must exit 0
4. Start the dev server: `npx expo start`
5. Open the app on a device or simulator; log in with Spotify
6. Select a source playlist and one or more destination playlists
7. Navigate to the swipe screen — verify the first track card appears
8. Swipe right (like) — verify the card animates off to the right and the next card appears
9. Swipe left (skip) — verify the card animates off to the left
10. Tap the SuperLike button — verify card animates upward
11. Tap the Undo button — verify the previous card reappears
12. Tap the DecideLater button — verify the card is removed and the track will re-appear at end of queue
13. Tap the edit destination icon — verify the DestinationEditor modal opens with three scope options
14. Kill the app mid-session (force-quit on device) and relaunch — verify session resumes at the correct track position
15. Check the backend: `GET /sessions` or inspect the Supabase database to confirm a session record exists with liked_count / super_liked_count incrementing correctly

Expected: all checks pass, no crashes, card stack behaves correctly, backend receives swipe records.
</how-to-verify>

<resume-signal>Type "approved" if all checks pass, or describe which step failed with any error messages</resume-signal>
</task>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Expo Router params → screen | playlistId comes from URL params — treat as untrusted |
| Screen → Adapter | Adapter calls are authenticated; screen passes playlistId to adapter.getPlaylistTracks() |
| Screen → Backend | supabaseToken from authStore included in service constructors |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-07-01 | Tampering | playlistId from Expo Router params | accept | playlistId is passed to adapter.getPlaylistTracks() and backend; Spotify API validates playlist access server-side. Backend receives it as source_playlist_id (not used in access control — session.user_id is the access gate). |
| T-02-07-02 | Repudiation | AppState flush — double-flush of pendingSyncSwipes | mitigate | POST /swipes is idempotent by upsert on (session_id, spotify_track_id) — duplicate flush produces no duplicate records |
| T-02-07-03 | Denial of Service | Queue fetch — very large playlist (1000+ tracks) | accept | adapter.getPlaylistTracks() accepts offset/limit; Phase 2 fetches with default limit=50. Future phases can add pagination. User can still swipe the first 50 tracks immediately. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx jest --watchAll=false` all pass
- `npx expo lint` exits 0
- Screen renders SwipeEngine with a loaded queue (not empty state)
- Session close fires on screen unmount (observable in backend session record's ended_at column)
</verification>

<success_criteria>
1. Full swipe session works end-to-end — track plays, gestures and button bar both record swipes
2. Super like writes to all active destination playlists AND saves to Spotify Liked Songs
3. Decide Later tracks re-surface at front of queue on next session for the same playlist
4. PlaylistWriter fires for all active destinations in parallel; never blocks the swipe UI
5. Mid-session destination editor works for all three scopes
6. Session opens on swipe start and closes on exit — SessionTracker records counts
7. App survives a mid-session kill and resumes correctly
8. No Spotify-specific handling in any swipe UI component
</success_criteria>

<output>
Create `.planning/phases/02-swipe-core/02-07-SUMMARY.md` when done
</output>
