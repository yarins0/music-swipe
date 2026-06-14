# MusicSwipe — Full Codebase Review (high effort)

**Date:** 2026-06-08
**Scope:** Entire codebase (`src/`, `backend/`, `app/`) — full-source recall review (no pending diff at review time).
**Method:** 3 parallel review agents partitioned by subsystem (adapter/player/playlist · swipe/stores/services · app/components/auth/backend) → manual verification of every load-bearing finding against source → false-positive refutation → cross-reference against the prior review (`code-review-2026-05-31.md`).
**Status:** Findings ranked & verified. **No fixes applied yet** — this document is the work order for the fix-it session.

---

## How to use this document (for an automated fix session)

A new chat can fix these findings start-to-finish using only this file. Suggested opening prompt:

> Read `docs/code-review-2026-06-08.md`. Fix the findings in order (Critical → High → Medium → Low), one commit per finding. For each: make the change, add/extend the tests named in the finding, run the verification commands, and check the box. Follow the project rules in `CLAUDE.md` — especially the adapter boundary and the PlaylistWriter sequence-test requirement. Do not change behavior beyond the finding without flagging it.

**Ground rules the fix session must follow (from `CLAUDE.md`):**
- **Adapter boundary:** nothing outside `src/adapters/` may import from `src/adapters/spotify/` or reference Spotify-specific strings/types. Map all platform errors to `PlatformError` inside the adapter.
- **Capability flags, not platform checks:** use `supportsSeek` / `requiresExplicitFollow` / `requiresPremium`, never `if (platform === 'spotify')`.
- **PlaylistWriter changes → sequence test required:** any change to write/undo/super-like/filter logic needs a final-state test in `src/services/__tests__/PlaylistWriter.sequences.test.ts` (assert state on `MockAdapter.playlistContents` / `fixtures.likedTrackIds`, not call counts) **and** call-level coverage in `PlaylistWriter.test.ts`. Use `jest.useFakeTimers()` + `await jest.runAllTimersAsync()` to drain fire-and-forget writes; destinations `mock-playlist-1` / `mock-playlist-2`.
- **New adapter method → MockAdapter + adapter-contract:** stateful mock impl + parity assertion in `src/adapters/__tests__/adapter-contract.test.ts`.

**Verification commands (run after each fix):**
```bash
npx jest                 # mobile unit/sequence tests
npx tsc --noEmit         # type check (project uses TS 5.9.x)
npx expo lint            # mobile lint
cd backend && npm test && npm run lint   # backend
```
Run `graphify update .` after committing code changes to refresh the knowledge graph.

---

## Findings

### ☑ C1 — Decide-later restore reads the wrong response field (CRITICAL)
**Files:** `app/(tabs)/swipe/[playlistId].tsx:264-289` (consumer) · `backend/src/routes/swipes.ts:445-456` (producer)
**Verified:** yes.
The backend `GET /swipes` returns hydrated track metadata under `track` (`track: tracksById.get(...) ?? null`). The swipe screen's `fetchPending` reads `s.metadata?.title/.artist/.albumArtUrl/.durationMs/.previewUrl` — there is no `metadata` field, so every field falls back: `title = spotifyTrackId`, empty artist, no art, `durationMs = 0`.
**Scenario:** Defer a track → reopen the playlist → restored card shows the raw Spotify ID as title, blank artist, broken art, zero-length track (seek/segment math degenerates to 1 segment).
**Fix:** Map from `s.track`. Align field names with the backend `TrackResponse` shape (see `backend/src/routes/trackResponse.ts` and the nested `track` object built in `BackendSync.sendBatch` lines 123-135: `uri,title,artist,artists,album,albumArtUrl,durationMs,previewUrl`). Update the local response type to `{ swipes: { spotifyTrackId: string; track: TrackResponse | null }[] }`.
**Tests:** Add a contract test asserting the `GET /swipes` JSON shape the mapper expects (guard against future drift). Manually verify a defer→reopen round-trip shows real metadata.

### ☑ C2 — Cancelled pan gesture never springs back; card can freeze (HIGH; was flagged Critical)
**File:** `src/swipe/useSwipeGesture.ts:136-184`
**Verified:** yes (structural). Frequency note: only triggers on gesture *cancellation*, not the normal swipe/release path — uncommon but leaves a visibly broken deck when it happens.
`Gesture.Pan()` defines only `.onUpdate` and `.onEnd`. RNGH fires `.onEnd` only on a normal end; an interrupted/cancelled gesture fires `.onFinalize` (`success=false`), which is unhandled. A mid-drag cancellation (OS pointer-cancel, navigation interrupt, a competing gesture winning) leaves `translateX/Y/rotation` at the dragged offset with neither fly-off nor snap-back running. The card stays frozen until the next `track.id` change triggers `resetCard` via effect.
**Fix:** Add `.onFinalize((_e, success) => { if (!success && !isAnimating.value) { spring translateX/translateY/rotation back to 0 using the existing snapBack config } })`. Keep the `isAnimating` guard so it never fights an in-progress fly-off.
**Tests:** Unit test the gesture builder if feasible, or document a manual repro (background the app mid-drag → card recenters).

### ☑ H1 — Spotify token-refresh concurrent burst → forced logout (HIGH)
**File:** `src/adapters/spotify/spotifyFetch.ts:66-69` (+ context `src/auth/AuthGateway.ts:6-22`)
**Verified:** yes (narrowed). The `auth` context uses getters reading live store state, so the *sequential* second-refresh case is already handled (per the in-code comment). The residual bug is concurrency: there is **no in-flight dedup**. On session start, multiple `spotifyFetch` calls (playlists + liked-count + devices) fire in parallel; if the token is inside the 5-min proactive buffer, each calls `refreshSpotifyToken` with the same refresh token. PKCE rotates the refresh token, so the first succeeds and the rest send the now-revoked token → non-OK → `onAuthExpired()` → `clearAuth()` → logged out mid-session.
**Fix:** Single-flight the refresh. Hold one module-level `inFlightRefresh: Promise<string> | null`; concurrent callers await the same promise; clear it in `finally`. Apply to both the proactive path (line 67) and the reactive 401 path (line 87).
**Tests:** Unit test `spotifyFetch` with N concurrent calls inside the buffer (mocked token endpoint) → assert exactly one refresh call and zero `onAuthExpired` calls.

### ☑ H2 — `onAuthExpired` fires on any non-OK refresh → transient outage = permanent logout (HIGH)
**File:** `src/adapters/spotify/spotifyFetch.ts:35-38`
**Verified:** yes.
`refreshSpotifyToken` treats every non-OK token-endpoint response (including transient 5xx / network blips) as auth-expired and calls `onAuthExpired()`, discarding the refresh token permanently.
**Fix:** Only treat `400`/`401` (`invalid_grant`) as auth-expired. For 5xx / network errors, throw a retryable error (`PlatformErrorCode.UNKNOWN` or a new `NETWORK_ERROR`) **without** calling `onAuthExpired`. Combine with H1's single-flight so a failed shared refresh rejects all waiters consistently.
**Tests:** Unit test: 500 from token endpoint → throws, `onAuthExpired` NOT called; 400 → `onAuthExpired` called once.

### ☑ H3 — PlaylistWriter durable-queue read-modify-write race → lost crash-recovery entries (HIGH)
**File:** `src/services/PlaylistWriter.ts:193-251` (esp. `destinationIds.map(async …)` at 194 and readQueue→push→persistQueue at 222-230)
**Verified:** yes.
For regular (non-Liked-Songs) destinations the queue is mutated read-modify-write with no serialization. Worse, within a single `write()` the `.map(async …)` runs all destinations concurrently, so liking one track into 2+ regular playlists races the queue against itself: both read the same snapshot, each appends only its own entry, the second `persistQueue` overwrites the first → a queue entry is lost. The add itself still fires (step 2 is independent), so the like usually lands — what's lost is the durable retry guarantee: if that add then fails, `drainStoredQueue` won't retry it.
**Fix:** Serialize queue mutations behind a single in-memory promise chain (a `private queueMutex: Promise<void>` that each mutation `await`s then extends), or do an atomic read-append-write inside one critical section. Keep mutations off the swipe hot path (still fire-and-forget).
**Tests (required — PlaylistWriter rule):** sequence test — like one track into `mock-playlist-1` + `mock-playlist-2` concurrently, force the first add to fail, drain timers, assert the failed entry survives in the persisted queue. Plus call-level coverage.

### ☑ H4 — Backend API has no rate limiting except `/auth/register` (HIGH)
**Files:** `backend/src/index.ts`, `backend/src/routes/{swipes,sessions,users}.ts`
**Verified:** yes.
The only throttle is on `/auth/register` (`auth.ts:7`). `/swipes`, `/sessions`, `/users` are unthrottled; each `GET /sessions` fans out to several sequential Supabase queries.
**Fix:** Add a global `express-rate-limit` in `index.ts` keyed on `req.userId` (after auth middleware) with an IP fallback for unauthenticated routes. Pick limits that fit real client behavior (e.g. session start fires a burst).
**Tests:** Integration test hitting `/sessions` past the limit → 429.

### ☑ H5 — Undo of a like can delete a track the user already owned (MEDIUM-HIGH)
**File:** `src/services/PlaylistWriter.ts:255-298, 316-318` (`undoWrite`/`undoWriteAsync`/`undoSuperLike`)
**Verified:** yes. Probability note: requires the track to already exist in a chosen *regular* destination playlist before the like.
Liked Songs is guarded by `libraryWrittenIds` (only removes what we added this session). Regular playlists have **no** such guard — undo unconditionally calls `removeFromPlaylist(playlistId, trackId)` (line 274/296), and Spotify removes *all* occurrences of the URI.
**Scenario:** Track X already in destination P → user likes X (re-adds) → undoes → `removeFromPlaylist(P, X)` deletes X entirely, destroying the pre-existing copy.
**Fix:** Mirror the Liked-Songs guard for regular playlists: record per-session added `(trackId, playlistId)` pairs (a `Set<string>` keyed `trackId|playlistId`, persisted alongside `libraryWrittenIds`) when `write` succeeds, and only `removeFromPlaylist` on undo for pairs we actually added this session. Consider whether the dedup-removal design (comment at lines 188-192) should also snapshot pre-existence.
**Tests (required):** sequence test — pre-seed `mock-playlist-1` with track X, like X into it, undo, assert X still present (one copy) in `MockAdapter.playlistContents`.

### ☑ M1 — `playTrackAt` stale-result race sets seek state for the wrong track (MEDIUM)
**File:** `src/swipe/SwipeEngine.tsx:233-267`
**Verified:** logic.
`playTrackAt` is async and fire-and-forgot from the index effect. Fast swiping can resolve `play(trackA)` after `play(trackB)`, so `setIsSeekEnabled` (and the position poll loop + segment dots) reflect trackA while the user is on trackB.
**Fix:** Capture the index/track at call time; before `setIsSeekEnabled`, bail if `currentIndex` has changed (compare against a ref) — mirror the stale-guard pattern the seek handlers already use (`positionRef`).

### ☑ M2 — "Save as playlist" shows success before writes land (MEDIUM)
**File:** `app/(tabs)/session-end.tsx:~222` (`handleSaveAsPlaylist`)
**Verified:** logic.
`writer.write(...)` is fire-and-forget in a loop, then the button flips to "Saved ✓" in `finally`. Queued writes can later fail silently → success shown for an empty/partial playlist.
**Fix:** Await the writer queue drain, or surface the existing `onWriteError` callback to keep the button in a pending state until writes confirm (or report failure).

### ☑ M3 — Logout leaves the previous user's pending writes on the device (MEDIUM)
**Files:** `src/stores/authStore.ts:113-127` (`clearAuth`) · `src/services/PlaylistWriter.ts:27-28`
**Verified:** yes.
`clearAuth` resets swipe/session stores but not the PlaylistWriter AsyncStorage keys (`@music-swipe/playlist-write-queue`, `@music-swipe/library-written-ids`). On next login `drainStoredQueue` replays the prior user's adds against the new account.
**Fix:** Add a static `PlaylistWriter.clearStoredState(storage?)` that removes both keys; call it from `clearAuth` alongside the SecureStore deletes. NOTE: H5 added a third persisted key `@music-swipe/added-playlist-pairs` (the regular-playlist undo guard) — clear it here too.

### ☑ M4 — Swipe upsert and pending-reconciliation run in separate transactions (MEDIUM)
**File:** `backend/src/routes/swipes.ts:265-289` (+ reconcile at ~56-102)
**Verified:** logic.
`upsert_swipes` RPC commits, then a separate batch DELETE reconciles dangling pending rows. A crash/failure between them leaves stale `pending` rows that resurface in a later decide-later fetch; the 500-on-delete path can also cause client retry double-counting.
**Fix:** Move the reconciliation DELETE into the `upsert_swipes` plpgsql function (single transaction) via a new migration, or make the endpoint idempotent on retry. (Migrations live in `backend/src/db/migrations/`, applied via Supabase SQL editor in order — see prior review's 2026-06-04 note.)

### ☑ M5 — `useMatchesStore` recomputes unmemoized on every render (MEDIUM, perf)
**File:** `src/matches/useMatchesStore.ts:21-42`
**Verified:** yes.
Full sort + `flatMap` + per-record allocation + new array identity on every store change, defeating downstream `React.memo`. Also note the documented "matches come from the server" invariant is not enforced here (local-history derived); prior review deferred the server-reconciliation half (old M7) — keep that deferral, only fix the memoization now.
**Fix:** Wrap the derivation in `useMemo` keyed on `sessions`.

### ☑ M6 — `TrackPlayer.play` flattens all errors to `strategy:'none'` (MEDIUM)
**File:** `src/player/TrackPlayer.ts:30-37`
**Verified:** yes. Product note: current UX intentionally collapses all failure to an "Audio unavailable" badge, so this is partly a product decision.
Catching everything loses the recoverable (`NO_ACTIVE_DEVICE` → deep link) vs fatal (`AUTH_EXPIRED`) distinction.
**Fix (if pursued):** widen `PlaybackResult` to carry an optional `PlatformErrorCode`; rethrow non-`PlatformError`. Update `MockAdapter`/contract per the rules if the interface gains anything. Confirm with product whether the badge should branch before implementing.

### ☑ L1 — Adapter-boundary leak in PlaylistResolver (LOW, arch)
**File:** `src/playlist/PlaylistResolver.ts:30-44`
Spotify URL/URI/22-char-ID regexes and `extractSpotifyPlaylistId` live outside `src/adapters/` (violates the adapter boundary rule). **Fix:** move parsing behind a new adapter method (e.g. `adapter.parsePlaylistReference(input)`); add it to `MusicPlatformAdapter`, `MockAdapter`, and the contract test per the rules.

### ☑ L2 — Production logging of scopes / deep-link URIs (LOW, security hygiene)
**Files:** `src/auth/useSpotifyAuth.ts:105` (granted scopes) · `src/deeplink/PlatformDeepLink.ts:4` (every deep-link URI). **Fix:** gate behind `__DEV__`. (Token persistence already uses `expo-secure-store` — verified, no action.)

### ☑ L3 — `flushPending` drops payloads on failure (LOW)
**File:** `src/services/BackendSync.ts:99-109`. The spliced batch is lost if `sendBatch` rejects (session-end flush on a network blip → those swipes never retried). **Fix:** on rejection, unshift the batch back into `pending`.

### ☑ L4 — `BackendSync.postSwipe` + `flushPending` in-flight double-send (LOW — idempotent)
**File:** `src/services/BackendSync.ts:38-53, 99-109`. The 2026-06-04 M1 fix removes a payload from `pending` on resolve, but `flushPending` can still grab a payload during its in-flight window and re-POST it. **Impact is benign:** the backend upserts on `UNIQUE(session_id, spotify_track_id)` (2026-06-04 M2/M8), so a duplicate send is idempotent — cost is one redundant request, no data duplication. **Fix (optional):** mark in-flight payloads (a `Set` of references) and have `flushPending` skip them.

### ☐ L5 — Missing null-art guard in SessionCard (LOW)
**File:** `src/components/SessionCard.tsx:~38`. Passes `uri: null` to `expo-image` for null-art restored tracks (PlaylistRow and session-end guard this; SessionCard's `LikedRow` doesn't). **Fix:** add the placeholder branch like the others.

### ☐ L6 — `NO_ACTIVE_DEVICE` leaves the swipe screen on an infinite spinner (LOW)
**File:** `app/(tabs)/swipe/[playlistId].tsx:~344`. Fires the deep link + alert but doesn't set a retryable phase or re-fetch on return → stuck on "Loading playlist…". **Fix:** set an actionable error phase with Retry, or re-run `fetchQueue` on `AppState` `active`.

### ☐ L7 — `spotifyFetch` blanket-overrides `Content-Type` (LOW)
**File:** `src/adapters/spotify/spotifyFetch.ts:71-79`. `options.headers` is spread before the hardcoded `Content-Type: application/json`, so a caller can never override it. **Fix:** spread `options.headers` last, or only set the header when a body is present.

### ☑ L8 — Style memo deps use `[isDark]` but read `activeColors` (LOW)
**Files:** `SwipeEngine.tsx`, `SwipeCard.tsx`, `ButtonBar.tsx`, `DestinationEditor.tsx`. Stale styles if a palette changes without a brightness flip. **Fix:** depend on `activeColors`. (Convention, no impact today.)

### ☐ L9 — Other small items (LOW)
- `app/(tabs)/index.tsx`: unused `clearAuth` selector + unused `Platform` import (lint noise).
- `src/components/PlaylistAccessGuard.tsx:~23`: "Open in Spotify" button has no `onPress` (Phase 5 stub) — wire the deep link or confirm the component is unreferenced.
- `src/adapters/spotify/SpotifyAdapter.ts:~150-157`: `getPlaylistById(LIKED_SONGS)` paginates all playlists to read one count — fetch `/me/tracks?limit=1` directly.
- `MockAdapter.getCurrentTrack` returns a track while `SpotifyAdapter` returns `null` — behavioral divergence under contract parity; make the mock configurable.
- `backend/src/routes/swipes.ts:343,377`: `source_playlist_id` query param unvalidated (parameterized by supabase-js, no SQLi) — clamp length/charset at the boundary.
- `backend/src/routes/auth.ts:84-105`: first-time-registration race → second concurrent `createUser` 500s; retry `signInWithPassword` once before failing.

---

## Verified non-issues / false positives (do NOT "fix")

- **`isAuthenticating` missing** — REFUTED; exists at `authStore.ts:17,44,51-52`.
- **Token storage insecure** — RESOLVED; `authStore` uses `expo-secure-store`.
- **`H7` Liked-Songs paging skip (reported)** — *needs caller verification before treating as a bug:* `getPlaylistTracks` caps the Liked-Songs page at 50 while reporting full `total`; only a real defect if a caller advances its offset by the requested page size rather than `tracks.length`. Check `app/(tabs)/swipe/[playlistId].tsx` queue paging first; fix only if the skip reproduces.
- **Second-pass injection vs session-end double-fire** (`SwipeEngine.tsx:319-337`) — safe under synchronous Zustand `set`; fragile coupling, worth a comment/test, not a bug.
- **`undo()` at index 0** (`swipeStore.ts`) — UI-guarded; an internal guard is defensive-only.
- IDOR ownership checks correct on `sessions`/`swipes`/`users/me`; SQL parameterized; migrations idempotent; swipe handler records to Zustand before fire-and-forget sync (invariant upheld); position-poll `setInterval` is cleared (no leak).

---

## Suggested fix order

1. **C1** (decide-later restore) — user-visible, isolated, high value.
2. **H2** then **H1** (auth refresh: stop spurious logout, then single-flight) — do together in `spotifyFetch`.
3. **C2** (gesture recenter).
4. **H3**, **H5** (PlaylistWriter queue race + undo guard) — both need sequence tests; do together.
5. **H4** (backend rate limiting).
6. **M1–M6**, then **L1–L9** as capacity allows.

Each finding = one focused commit (no AI-credit in messages, per project git rules). Update this file's checkboxes as you go.
