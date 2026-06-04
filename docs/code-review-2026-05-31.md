# MusicSwipe — Full Codebase Review (xhigh)

**Date:** 2026-05-31
**Scope:** Entire codebase (`src/`, `backend/`, `app/`) — full-source recall review (the working tree has no pending diff).
**Effort:** xhigh — recall mode (catch every real bug; err toward surfacing).
**Method:** 6 parallel finder agents (partitioned by subsystem, applying all correctness + cleanup/altitude lenses) → self-verification by reading every cited location → refutation of false positives → gap sweep → ranked findings.

---

## Status

- [x] Phase 0 — Scope gathered (~4,906 LOC `src/`, ~859 LOC `backend/`, plus `app/` router screens)
- [x] Phase 1 — Finder angles (6 agents, ~40 raw candidates)
- [x] Phase 2 — Verification (each candidate checked against source; 7 refuted)
- [x] Phase 3 — Gap sweep
- [x] Final ranked findings (15)

---

## Fixes applied (2026-05-31)

- **H1 — seek handlers** ✅ Added `TrackPlayer.getCurrentPositionMs()` (delegates to the adapter, returns 0 when seek is unsupported). `handleSeekBack`/`handleSeekForward` now read the live position and seek one step relative to it, where step = `max(20 000 ms, durationMs / 8)` (per request: 1/8 of the track, 20 s floor for tracks under 160 s). Forward seeks clamp to the track end. (`src/player/TrackPlayer.ts`, `src/swipe/SwipeEngine.tsx`)
- **H2 — drain queue freeze** ✅ Failed writes are re-queued with `attempts: 0` instead of `MAX_ATTEMPTS`, so the next launch retries them from scratch once connectivity returns. (`src/services/PlaylistWriter.ts`)
- **H5 — backend URL port** ✅ Added `src/config.ts` exporting a single `BACKEND_URL` (default `http://localhost:3000`, matching the backend's own default). `useSpotifyAuth.ts`, `app/(tabs)/swipe/[playlistId].tsx`, and `app/(tabs)/session-end.tsx` now import it instead of each redeclaring a divergent default. **Follow-up:** `eas.json`'s `development` build profile still sets `EXPO_PUBLIC_BACKEND_URL=http://localhost:3001` — left unchanged pending confirmation, but it disagrees with the 3000 decision and should likely be updated.

- **H4 — correction + error swallowing** ✅ The endpoint diagnosis was **wrong**: the Spotify API changed and `/me/library` is valid, so `saveToLibrary`/`isInLibrary` are fine. The real defect — non-`RATE_LIMITED` write failures being swallowed by `console.warn` — is fixed: `PlaylistWriter` now takes an `onWriteError` callback, fired only for non-retryable errors (rate-limit exhaustion stays silent since the durable queue retries it), wired to a once-per-session alert in the swipe screen. (`src/services/PlaylistWriter.ts`, `app/(tabs)/swipe/[playlistId].tsx`)
- **Tooling — tsconfig** ✅ `ignoreDeprecations: "6.0"` → `"5.0"` (installed TS is 5.9.3, which rejects the unreleased `"6.0"` token); `tsc --noEmit` now runs and passes clean across the project.
- **Tooling — stale test mock** ✅ `PlaylistWriter.test.ts` adapter mock was missing `canReadUnownedPlaylists`, `getUserProfile`, and `openPlaylistInApp`; added all three.

Verification: full suite 325/325 pass; `tsc --noEmit` exits 0; changed files lint clean (0 errors).

---

## Fixes applied (2026-06-04)

Second pass — the medium/low items that survived the `de9950e` multi-session refactor, plus M5. All committed on `main`.

- **M1 — `BackendSync` re-sends every swipe** ✅ `postSwipe` removes a payload from the pending queue once its individual send resolves, so `flushPending` no longer re-POSTs already-sent swipes; failed sends stay queued for the next flush. (`src/services/BackendSync.ts`) — `0a8c70e`
- **M2 — `swipes` has no `UNIQUE(session_id, spotify_track_id)`** ✅ Added the constraint and switched `POST /swipes` to upsert on it (removing the racy SELECT-then-INSERT). (`backend/src/db/schema.sql`, migration `0001`) — `fb81c8b`
- **M5 — Session "Songs Sorted" stat is wrong** ✅ Root cause ran deeper than first diagnosed: `PATCH /sessions` **SET** each count to the per-swipe delta (so the stored column never accumulated), and `session-end.tsx` read `data.swipe_count` while `GET /sessions` returns `swipedCount` (camelCase) — making the client overwrite already a silent no-op. Fix (chosen approach: compute server-side): `GET /sessions` derives swiped/liked/super-liked counts from the `swipes` table (decided swipes only; `pending` excluded); the client drops `incrementCounts` and trusts the local `SessionEntry`; `swipeStore.recordSwipe`/`undo` stop counting decide-later toward `swipedCount` so local matches the server. (`backend/src/routes/sessions.ts`, `src/services/SessionTracker.ts`, `src/swipe/SwipeEngine.tsx`, `app/(tabs)/swipe/[playlistId].tsx`, `app/(tabs)/session-end.tsx`, `src/stores/swipeStore.ts`) — `66b90c5`
- **M6 — Per-track destination override leaks after Decide-Later** ✅ `handleDecideLater` now clears `perTrackOverrideIds`, mirroring `handleSwipe`. (`src/swipe/SwipeEngine.tsx`) — `66b90c5`
- **M8 — Batch swipe writes are not transactional** ✅ `POST /swipes` writes via a single transactional `upsert_swipes` Postgres function; a mid-batch failure can no longer leave partial rows. (`backend/src/routes/swipes.ts`, migration `0001`) — `fb81c8b`
- **L2 — Backend doesn't validate `destinationPlaylistIds` element types** ✅ Rejects any element that is not a non-empty string. (`backend/src/routes/swipes.ts`) — `fb81c8b`
- **L3 — Duplicated retry/guard logic + theme-bypassing colors** ✅ Extracted one shared RATE_LIMITED retry helper and one Liked-Songs guard helper in `PlaylistWriter`; re-themed `DestinationEditor` to `theme.ts` tokens (Spotify green → `colors.primary`; dark sheet → `colors.surface`). (`src/services/PlaylistWriter.ts` — `af5a5e1`; `src/swipe/DestinationEditor.tsx` — `b6c175f`)

**Deferred (by decision):**

- **M7 — Matches read only local history, never the server** — intentionally deferred: the `de9950e` refactor made client/AsyncStorage the source of truth for session history this round; server reconciliation is revisited when backend session persistence is built.
- **L1 — `swipedAt` used as record identity** — deferred pending a decision on the id source + back-compat for records already persisted in AsyncStorage.

**Migration applied (2026-06-04):** `backend/src/db/migrations/0001_swipes_unique_and_upsert_fn.sql` was run on Supabase via the SQL editor in order (pre-dedup → add `UNIQUE` constraint → create `upsert_swipes`); constraint and function verified present in the catalog. `POST /swipes` now works against the real DB. (Unit tests mock the RPC and passed regardless.)

Verification: backend 61/61, mobile 354/354; `tsc --noEmit` exits 0; changed files lint clean.

---

## Summary

15 findings survived verification: **5 high**, **7 medium**, **3 low/cleanup**. The two highest-impact bugs are both in the swipe hot path: **both segment-seek handlers are broken** (tap-left always restarts the track; tap-right jumps to a fixed 20 s), and **the playlist-write retry queue permanently abandons any write that fails once** (a like silently lost forever). A third class worth verifying against the live Spotify API: the **Liked-Songs / saved-tracks adapter methods call `/me/library?uris=`**, which does not match Spotify's documented saved-tracks API (`/me/tracks?ids=`) — and because `PlaylistWriter` swallows the resulting error, the failure is invisible.

Severity legend: **High** = wrong result / data loss in a normal flow. **Medium** = wrong result in an edge case, stats/UX divergence, or latent data-integrity gap. **Low** = unlikely trigger or maintainability.

---

## High severity

### H1 — Both segment-seek handlers are broken
**File:** `src/swipe/SwipeEngine.tsx:119-135` · **Lens:** A (line-by-line) / E (player)

```ts
const handleSeekBack = useCallback(async (): Promise<void> => {
  const pos = await trackPlayer.seekTo(0).then(() => 0);   // ← pos is hard-coded to 0
  void trackPlayer.seekTo(Math.max(0, pos - 20000));        // ← Math.max(0, -20000) = 0
}, [trackPlayer]);

const handleSeekForward = useCallback(async (): Promise<void> => {
  void trackPlayer.seekTo(20000);                            // ← absolute 20 s, not relative
}, [trackPlayer]);
```

`handleSeekBack` first seeks to absolute 0, then derives `pos` from that constant `0`, so every tap-left audibly restarts the track from the beginning. `handleSeekForward` seeks to the absolute 20 s mark regardless of the current position, so tapping right at 1:30 jumps *backward* to 0:20. `TrackPlayer` exposes no current-position getter (`TrackPlayer.ts` has only `play`/`pause`/`seekTo`), even though `SpotifyAdapter.getCurrentPositionMs()` exists — the handlers were never wired to it. The `SegmentNavigator` ±20 s contract is broken in both directions.
**Fix:** add `getCurrentPositionMs()` to `TrackPlayer`, read it, then `seekTo(current ± 20000)`.

### H2 — `drainStoredQueue` permanently freezes any write that fails once
**File:** `src/services/PlaylistWriter.ts:344, 375` · **Lens:** A / B

```ts
for (let attempt = entry.attempts; attempt < MAX_ATTEMPTS; attempt++) { ... }
...
if (!succeeded) {
  remaining.push({ ...entry, attempts: MAX_ATTEMPTS });   // ← stamps the ceiling
}
```

When a queued write exhausts its retries, it is re-persisted with `attempts: MAX_ATTEMPTS (5)`. On the next launch the loop `for (let attempt = 5; attempt < 5; …)` never executes, so `succeeded` stays `false` and it is re-frozen at `5` again — forever. A track liked while offline (or during a Spotify rate-limit window) that survives to a second drain is **never written again, even after connectivity returns**, with no surfaced error. The like is silently lost.
**Fix:** persist the real attempt count reached (or a `nextRetryAt` timestamp), not the ceiling; reset on launch.

### H3 — Playlist load is capped at one page (100 tracks; 50 for Liked Songs)
**File:** `app/(tabs)/swipe/[playlistId].tsx:325` · **Lens:** B (removed/missing pagination)

```ts
// Fetch all tracks — paginate if needed (simple single-page fetch for now)
const { tracks, total } = await adapter.getPlaylistTracks(playlistId, 0, 100);
```

Despite `PlaylistResolver`'s "paginates tracks" contract, this is a single page. For a playlist > 100 tracks, everything past track 100 is dropped (`total` still reports the full count, so the progress bar is misleading). For **Liked Songs the cap is 50** — `SpotifyAdapter.getPlaylistTracks` clamps `/me/tracks` to `effectiveLimit = Math.min(limit, 50)` (`SpotifyAdapter.ts:175`). Worse, on resume `tracks.slice(storedAbsoluteIndex)` goes empty once `absoluteIndex ≥ 100`, and the fallback `queueTracks = sliced.length > 0 ? sliced : tracks` (line 330) silently **restarts the user at track 0**.
**Fix:** loop `getPlaylistTracks` over offsets until `total` is reached (or page lazily as the stack drains).

### H4 — Saved-tracks / library adapter methods call a non-Spotify endpoint
> **CORRECTION (2026-05-31):** The endpoint claim below is **wrong** — the Spotify API changed and `/me/library` is valid. The endpoint methods are fine. The real, confirmed defect is the **swallowed non-`RATE_LIMITED` errors** described at the end of this entry; that part was fixed (see "Fixes applied").

**File:** `src/adapters/spotify/SpotifyAdapter.ts:304-330` · **Lens:** A / E · **Confidence:** verify against live API

```ts
async saveToLibrary(trackId: string): Promise<void> {
  const uri = encodeURIComponent(`spotify:track:${trackId}`);
  await spotifyFetch(`/me/library?uris=${uri}`, { method: 'PUT' }, this.auth);   // ← /me/library + uris
}
async isInLibrary(trackId: string): Promise<boolean> {
  ... `/me/library/contains?uris=${uri}` ...
}
```

Spotify's "Your Music" / saved-tracks API lives at **`/me/tracks`** and keys on **`ids=`** (bare track IDs, comma-separated): `PUT /me/tracks?ids=…`, `DELETE /me/tracks?ids=…`, `GET /me/tracks/contains?ids=…`. There is no `/me/library` resource and the saved-tracks endpoints do not accept `uris=`. As written, `saveToLibrary` / `removeFromLibrary` / `isInLibrary` would 404/400. The impact is hidden because every caller swallows the error: `PlaylistWriter.write`/`superLike` treat a non-`RATE_LIMITED` failure as "non-retryable, abort" and log a warning — so liking to Liked Songs and super-likes to the library **never actually save**, with no user-visible failure. (Related: `addToPlaylist`/`removeFromPlaylist`/`getPlaylistTracks` use `/playlists/{id}/items`; verify that against the documented `/playlists/{id}/tracks` path too, since all three break together if it is wrong.)
**Fix:** route library methods to `/me/tracks` with `ids=`; verify every Spotify path against the live API (unit tests mock `spotifyFetch`, so they cannot catch a wrong URL).

### H5 — Frontend `BACKEND_URL` port defaults disagree
**Files:** `src/auth/useSpotifyAuth.ts:6` (`:3000`) vs `app/(tabs)/swipe/[playlistId].tsx:20` & `app/(tabs)/session-end.tsx:23` (`:3001`); backend `backend/src/index.ts:12` (`PORT ?? 3000`) · **Lens:** C (cross-file)

```ts
// useSpotifyAuth.ts
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';
// [playlistId].tsx & session-end.tsx
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
```

Three frontend defaults across two ports, and the backend defaults to 3000. With `EXPO_PUBLIC_BACKEND_URL` unset, login (3000) reaches the backend but the swipe screen and session-end (3001) do not — so session creation, swipe sync, pending-track fetch, and end-of-session stats all silently fail. Whichever way the env is configured, at least one of the two default sets is wrong.
**Fix:** define `BACKEND_URL` once in a shared module and import it everywhere; align the default with the backend's default port.

---

## Medium severity

### M1 — `BackendSync` re-sends every swipe
**File:** `src/services/BackendSync.ts:28-35` · **Lens:** B

`postSwipe` pushes the payload to `this.pending` **and** fires `sendBatch([payload])`, but never removes it from `pending` on success. `flushPending()` (called on app-foreground, on resume, and at session end) then re-POSTs every swipe already sent individually. The backend's read-then-insert dedup turns most of these into UPDATEs rather than duplicates, so it "works" — but it doubles request volume and, combined with M2, opens a real duplicate-row window.
**Fix:** remove a payload from `pending` once its individual send resolves (or don't fire per-swipe and rely solely on batched flush).

### M2 — `swipes` has no `UNIQUE(session_id, spotify_track_id)`
**File:** `backend/src/db/schema.sql:46-53` · **Lens:** B / E

`POST /swipes` enforces idempotency by SELECT-then-INSERT (`swipes.ts:102-135`), which is racy with no DB constraint to back it. Under the app's fire-and-forget + flush model (M1), two concurrent requests for the same `(sessionId, trackId)` can both find nothing and both insert, creating duplicate swipe rows — and a real `ON CONFLICT` upsert is impossible without the constraint.
**Fix:** add `UNIQUE (session_id, spotify_track_id)` and switch to an upsert.

### M5 — Session "Songs Sorted" stat is wrong
**Files:** `src/services/SessionTracker.ts:63-71`, `src/swipe/SwipeEngine.tsx:224-228, 266` · **Lens:** C

`incrementCounts` maps `skipped → swipedCount`, `liked → likedCount`, `superLiked → superLikedCount` — so a **liked or super-liked swipe never increments `swiped_count`**, while **decide-later increments it** (`handleDecideLater` sends `{ skipped: 1 }`, line 266). The backend `swiped_count` therefore equals *skipped + decide-later*, not total swipes. `session-end.tsx` then overwrites its correct optimistic total (`pendingSyncSwipes.length`) with this backend value, so "SONGS SORTED" under-reports (e.g. 10 swiped → shows 5) and the derived "DISCARDED" is wrong.
**Fix:** increment `swiped_count` for every swipe (or compute it as liked+superLiked+skipped server-side) and stop counting decide-later as a skip.

### M6 — Per-track destination override leaks after Decide-Later
**File:** `src/swipe/SwipeEngine.tsx:256-267` · **Lens:** A / B

`handleSwipe` clears the per-track override (`setPerTrackOverrideIds(null)`, line 239) after each swipe; `handleDecideLater` does not. If the user sets a "this track only" destination in the editor and then taps Decide Later instead of liking, the override survives onto the next card, so liking the *next* track writes it to the previous card's override destinations instead of the session default.
**Fix:** clear `perTrackOverrideIds` in `handleDecideLater` too.

### M7 — Matches read only local history, never the server
**Files:** `src/matches/useMatchesStore.ts:20-36`, `app/(tabs)/matches.tsx` · **Lens:** E

`useMatchesStore` derives matches solely from Zustand `likedHistory`; the History tab never reconciles with the backend, violating the documented "server is the source of truth; local cache is stale-while-revalidate only" invariant. On a new device or after `clearAuth` wipes local history, History shows nothing though the server has the data. The `fetchFromBackend` reconciler is only called by tests — and it requests `?status=liked,super_liked`, a comma value the backend's single-status validator (`swipes.ts:242`) rejects with 400, so it would not work if wired.
**Fix:** fetch from `/swipes` on focus and merge with the optimistic cache; fix the `status` query to the backend's supported form.

### M8 — Batch swipe writes are not transactional
**File:** `backend/src/routes/swipes.ts:142-184` · **Lens:** B / E

A batch inserts `swipes`, then loops inserting `swipe_destinations` per row. A failure partway (e.g. a bad destination id, see L2) returns 500 after some swipe rows and only some destinations are committed, leaving partial state that relies on the client retrying to self-heal. Supabase-js can't do multi-statement transactions inline — this needs a Postgres function/RPC.
**Fix:** wrap the batch in a DB function, or make destination writes idempotent and reconciled.

---

## Low severity / cleanup

### L1 — `swipedAt` ISO timestamp used as record identity and React key
**Files:** `src/stores/swipeStore.ts:196` (+ `markSynced`/`undo`/`removeFromHistory`), `app/(tabs)/matches.tsx:64`, `app/(tabs)/session-end.tsx:261` · **Lens:** D / B

Records are identified purely by `swipedAt` (millisecond ISO). Two records sharing a millisecond collide: `removeFromHistory(swipedAt)` deletes both, `undo` filters both out of `pendingSyncSwipes`, and `keyExtractor`/`key={r.swipedAt}` produce duplicate React keys. Human swipe cadence makes the collision unlikely today, but the identity-by-timestamp pattern will bite any future programmatic/bulk path.
**Fix:** assign each `SwipeRecord` a stable unique id at creation and key everything off it.

### L2 — Backend doesn't validate `destinationPlaylistIds` element types
**File:** `backend/src/routes/swipes.ts:62-68, 172` · **Lens:** input validation

Validation checks `Array.isArray` but not element types. `destinationPlaylistIds: [null]` violates `spotify_playlist_id TEXT NOT NULL` mid-batch (→ 500 + partial state per M7); `[123]`/`[{}]` get stored as bogus playlist ids and later drive writes against an invalid id.
**Fix:** reject non-string / empty elements at the boundary. (Same gap exists for `PATCH /sessions` numeric/date fields in `sessions.ts`.)

### L3 — Duplicated retry/guard logic and theme-bypassing colors
**Files:** `src/services/PlaylistWriter.ts:124-151 vs 344-372` (two copies of the RATE_LIMITED backoff loop); `:167-189 vs 289-317` (the Liked-Songs pre-existing-check repeated in `write` and `superLike`); `src/swipe/DestinationEditor.tsx` styles (hard-codes `#1db954`, `#1a1a2e`, etc., bypassing `theme.ts` — and the green doesn't even match the app primary `#fd297b`) · **Lens:** reuse / simplification

The duplicated backoff and library-guard blocks will drift (a fix applied to one path, missed in the other — e.g. honoring `Retry-After`, or the conservative `isInLibrary` default). The hard-coded palette makes a future theme/rebrand silently skip the destination editor.
**Fix:** extract `executeWithBackoff`-style retry into one helper used by both drain paths; extract `saveToLibraryIfNew(trackId)`; pull colors from `theme.ts`.

---

## Refuted candidates (checked, not bugs)

| Candidate | Why refuted |
|---|---|
| `spotifyFetch` refreshes the token on every call (stale `auth.expiresAt`) | `createSpotifyAuthContext` uses **live getters** (`get expiresAt()`), always reading fresh store state; `onTokenRefreshed` updates the store. (`AuthGateway.ts:6-22`) |
| `swipeStore.undo` `absoluteIndex` off-by-one (`>` vs `>=`) | `recordSwipe` advances when pre-increment `currentIndex ≥ pendingTracksCount`; `undo` reverses when pre-decrement `currentIndex > pendingTracksCount`. Since the undone position is `currentIndex-1`, the two boundaries are equivalent. Correct. |
| `session-end` `clearSession()` on unmount drops Save-as-Playlist writes | `PlaylistWriter.write` persists each entry to the AsyncStorage queue **before** the network call, and in-flight promises aren't cancelled by unmount; `drainStoredQueue` recovers on next launch. (The H2 freeze bug is the real residual risk.) |
| `lastPlayedIndex` ref not reset across sessions | `router.replace` to session-end unmounts `SwipeEngine`, so a new session gets a fresh `-1` ref; on resume, currentIndex is preserved and skipping replay of the current track is correct. |
| `GET /swipes` embedded `source_playlist_id` filter silently ignored | supabase-js `.match({ 'sessions.source_playlist_id': v })` emits `sessions.source_playlist_id=eq.v`, which PostgREST applies to the `!inner` embed — the documented way to filter embedded resources. |
| 429 `Retry-After` not honored on the final attempt | Intentional: there is no point sleeping when no retry follows; it correctly maps to `RATE_LIMITED`. |
| `supabaseAuth` uses the service-role key for `getUser` | A deliberately separated client (documented at `client.ts:17-24`); `getUser(token)` validates the user JWT regardless of the apikey, and this client is never used for queries. Hardening nit at most. |

---

## Methodology notes

- Finder agents were partitioned by subsystem (adapters; services/stores; swipe/player; auth/matches/components/router; backend; cross-cutting cleanup) so each built deep context rather than scanning thinly by lens.
- Every surviving candidate was verified by reading the cited file and its enclosing function; 7 were refuted against the actual source (above).
- H4 and the `/playlists/{id}/items` note rest on Spotify Web API knowledge; because all adapter HTTP is mocked in tests, these must be confirmed against the live API before fixing.
