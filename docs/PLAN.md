# PLAN.md — MusicSwipe
_Revision: applied YAGNI fix (platform agnosticism enforced from day 1), PlaylistAccessGuard split, spotifyFetch helper, deep link stub in Phase 1_

## Context
MusicSwipe is a mobile app (iOS + Android) where users connect their music platform account, pick a playlist to browse, and swipe through its tracks Tinder-style — right to like, left to skip — while the track plays live through their connected client. Liked tracks ("matches") are saved to one or more destination playlists. The entire codebase outside the adapter layer is strictly platform-agnostic; Spotify is the sole v1 implementation but the architecture treats it as interchangeable from day one. Assumed scale: indie launch, hundreds to low-thousands of users, single-region backend.

---

## Decisions Made

- **React Native + Expo** — cross-platform mobile, strong CV value, large ecosystem
- **Node.js + Express backend** — same language as frontend, simpler solo context switching
- **PostgreSQL** — relational, battle-tested, good fit for user/playlist/match data
- **Local-first swipe state** — swipes recorded on device immediately, synced to server per swipe; matches always fetched from server (source of truth for edits made outside the app)
- **Spotify playlist access** — owned/followed playlists readable directly; unowned playlists require user to follow them first (UI guided via generic `requiresExplicitFollow` capability flag — no Spotify-specific logic in UI)
- **Fixed-jump segment navigation** — ±20s taps for v1; `SegmentNavigator` interface designed for AI-segment upgrade in v2
- **Platform-agnostic codebase** — no Spotify strings, types, or logic outside `SpotifyAdapter`; all platform errors normalised to generic `PlatformError` types; adapter interface designed for ≥2 imagined platforms from day one
- **Deep link stub in v1** — `PlatformDeepLink` handler wired into architecture from Phase 1, no-op until Phase 5
- **Monolith backend** — single Express service, no microservices (YAGNI at this scale)
- **Button bar + gesture mapping** — five buttons mirroring Tinder (Undo · Skip · Super Like · Like · Decide Later); gestures are shortcuts (left=skip, right=like, up=super like); buttons are the primary discoverable path (see `.planning/notes/button-bar-gesture-design.md`)
- **Super Like** — writes to all active destination playlists AND saves to the user's native library (`saveToLibrary()` adapter method); requires `supportsLibrarySave` capability flag (see REQ-001)
- **Decide Later** — re-queues track in-session; if still undecided at session end, track returns to front of queue on next session for the same source playlist; stored as `pending` swipe status (see `.planning/notes/decide-later-session-persistence.md`)
- **Multi-destination playlists** — destination is multi-select; likes and super likes write to all active destinations in parallel; each swipe record stores the list of playlists it was written to; primary categorisation strategy is assign-later in Matches (see `.planning/notes/multi-destination-playlists.md`)
- **Mid-session destination editor** — secondary control (not in button bar) with three scopes: this track / from now on / entire session; adding a playlist is silent; removing prompts only when tracks already exist in the removed playlist (see REQ-006)
- **End-of-session screen** — celebratory album art mosaic of session likes + super likes; stats (swiped/liked ratio, super like count, top artist); three CTAs: Save as playlist · View Matches · Swipe another (see `.planning/notes/end-of-session-screen.md`)

---

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Mobile | React Native + Expo | Cross-platform, fastest solo iteration, strong ecosystem |
| Backend | Node.js + Express | Same language as frontend; lower cognitive overhead solo |
| Database | PostgreSQL (via Supabase hosted) | Managed hosting, free tier, no infra ops for solo dev |
| Auth | OAuth 2.0 PKCE flow (per platform) | Mobile-safe, no client secret on device |
| State (local) | Zustand + AsyncStorage | Lightweight, no boilerplate, persistent across sessions |
| Navigation | Expo Router | File-based, typed routes |
| Gestures | React Native Gesture Handler + Reanimated | Required for smooth swipe cards |

---

## System Components

| Component | Responsibility | Key Dependencies |
|---|---|---|
| `AuthGateway` | OAuth PKCE per platform, token storage, refresh flow | Expo AuthSession, AsyncStorage |
| `MusicPlatformAdapter` | Abstract interface: `getTracks()`, `play()`, `pause()`, `seek()`, `addToPlaylist()`, `removeFromPlaylist()`, `getUserPlaylists()`, `saveToLibrary()`, `createPlaylist()`, capability flags (`requiresExplicitFollow`, `supportsSeek`, `requiresPremium`, `supportsLibrarySave`, `supportsPlaylistCreation`) | — |
| `PlatformError` | Normalised error types (`NO_ACTIVE_DEVICE`, `PREMIUM_REQUIRED`, `RATE_LIMITED`, `AUTH_EXPIRED`, etc.) — all adapters map to these | — |
| `PlatformDeepLink` | Abstract interface for launching the platform's native app; v1 stub returns no-op | Expo Linking |
| `SpotifyAdapter` | Concrete Spotify impl of `MusicPlatformAdapter`; all Spotify API calls go through internal `spotifyFetch()` helper (handles token refresh + error normalisation) | Spotify Web API, Spotify Playback SDK |
| `PlaylistResolver` | Fetches + paginates track list from source playlist; normalises to internal `Track` type | `MusicPlatformAdapter` |
| `PlaylistAccessGuard` | UI component: reads adapter's `requiresExplicitFollow` flag, shows follow-first onboarding if needed | `MusicPlatformAdapter` |
| `SwipeEngine` | Manages track queue, swipe gesture state, like/skip/super-like/decide-later events, in-session decide-later queue, optimistic local state | Zustand, Gesture Handler |
| `TrackPlayer` | Controls playback on user's connected platform client (play, pause, seek) | `MusicPlatformAdapter` |
| `SegmentNavigator` | Tap-left/tap-right interface → seek calls; v1: fixed ±20s jumps | `TrackPlayer` |
| `MatchesStore` | Server-side liked tracks, playlist assignment, regret/remove flows | Backend API |
| `PlaylistWriter` | Adds/removes liked tracks to/from destination playlists via adapter; writes to all active destinations in parallel per like event; also handles `saveToLibrary()` on super like and `createPlaylist()` for session playlist creation | `MusicPlatformAdapter` |
| `SessionTracker` | Tracks per-session swipe counts, liked track IDs, and active destinations; powers end-of-session screen stats and session playlist creation | Zustand, Backend API |
| `Backend API` | OAuth token proxy, user data, swipe sync, matches CRUD, session records | Express, PostgreSQL |

---

## Implementation Phases

### Phase 1 — Auth, Interface Design & Skeleton (Foundation)
**Goal**: Platform adapter interface fully designed and enforced. User can log in and see their playlists. Nothing plays yet.

**Tasks**:
- [ ] Expo project setup with TypeScript, Expo Router, ESLint
- [ ] Define `MusicPlatformAdapter` abstract interface in full — design for ≥2 imagined platforms, not just Spotify. Include capability flags (`requiresExplicitFollow`, `supportsSeek`, `requiresPremium`, `supportsLibrarySave`, `supportsPlaylistCreation`). Include `saveToLibrary()` (REQ-001) and `createPlaylist()` (REQ-003)
- [ ] Define `PlatformError` normalised error enum — all adapters must map to this
- [ ] `PlatformDeepLink` stub: interface defined, `SpotifyDeepLink` wired in, logs "deep link triggered" (no-op)
- [ ] `SpotifyAdapter`: implement `getUserPlaylists()`, `getPlaylistTracks()` behind `spotifyFetch()` helper
- [ ] `AuthGateway`: Spotify OAuth PKCE, token storage, silent refresh
- [ ] Backend: Express server, PostgreSQL schema (users, playlists, tracks, matches)
- [ ] `PlaylistAccessGuard`: reads `requiresExplicitFollow` flag, shows follow-first UI if needed
- [ ] Playlist picker screen: shows owned + followed playlists (platform-agnostic UI)
- [ ] Destination playlist picker screen (multi-select; REQ-005)
- [ ] Lint rule or code review checklist: no Spotify-specific imports outside `adapters/`

**Exit criteria**: User logs in, sees their playlists, picks a source and destination. Interface contract is fully typed. No UI file imports anything from `adapters/spotify/` directly.

---

### Phase 2 — Swipe Core
**Goal**: The core swipe loop works. Track plays, user swipes, like/skip recorded.

**Tasks**:
- [ ] `TrackPlayer`: play/pause/seek via `MusicPlatformAdapter` (Spotify Playback SDK behind adapter)
- [ ] Active device check on session start → maps to `PlatformError.NO_ACTIVE_DEVICE` → UI shows "Open your music app first" + triggers `PlatformDeepLink` stub
- [ ] `SwipeEngine`: card stack UI, gesture handler (right=like, left=skip, up=super like)
- [ ] Button bar: Undo · Skip · Super Like · Like · Decide Later — buttons mirror gestures and are the primary discoverable path (see `.planning/notes/button-bar-gesture-design.md`)
- [ ] Super Like: calls `addToPlaylist()` for all active destinations + `saveToLibrary()` if `supportsLibrarySave` (REQ-001)
- [ ] Decide Later: removes track from current stack, adds to in-session pending queue; pending tracks re-queued at front of next session for same playlist (REQ-002; see `.planning/notes/decide-later-session-persistence.md`)
- [ ] Swipe status enum: `liked | super_liked | skipped | pending` (REQ-002)
- [ ] `SegmentNavigator`: tap left/right zones → seek ±20s via `TrackPlayer`
- [ ] Swipe event synced to backend per action (fire-and-forget, local state wins on conflict)
- [ ] Track card UI: album art, title, artist, progress bar (all data from normalised `Track` type)
- [ ] Auto-advance to next track on swipe completion
- [ ] End-of-main-queue state → trigger Decide Later second pass, then end-of-session screen
- [ ] `PlaylistWriter`: fires `addToPlaylist()` for all active destination playlists in parallel on like/super like (queued, retried on failure — never blocks swipe UI) (REQ-005)
- [ ] Mid-session destination editor: secondary control (not in button bar) with three scopes — this track / from now on / entire session; removal prompts before acting (REQ-006; see `.planning/notes/multi-destination-playlists.md`)
- [ ] `SessionTracker`: open session on swipe start, record swipe counts + liked track IDs, close on exit/queue exhaustion (REQ-004)
- [ ] Backend: `sessions` table (REQ-004)

**Exit criteria**: Full swipe session works end-to-end. Likes are saved to all active destinations. Super likes also save to library. Decide Later tracks re-surface next session. App survives a mid-session kill and resumes correctly. No Spotify-specific handling in swipe UI.

---

### Phase 3 — Matches & Playlist Writing
**Goal**: Liked tracks appear in a Matches screen and land in the right platform playlists.

**Tasks**:
- [ ] Matches screen (Tinder-style match grid/list) — always fetched from server; super liked tracks visually distinguished from regular likes
- [ ] Optimistic local cache for Matches: show stale-while-revalidate, refresh in background
- [ ] Regret flow: remove a match, undo playlist addition via `PlaylistWriter.removeFromPlaylist()` for all playlists the track was written to (multi-destination aware)
- [ ] Edit flow: move a match to a different destination playlist or add/remove destinations
- [ ] End-of-session screen: album art mosaic of session likes + super likes; stats (swiped/liked ratio, super like count, top artist); CTAs: Save as playlist · View Matches · Swipe another (see `.planning/notes/end-of-session-screen.md`)
- [ ] "Save as playlist" CTA: calls `createPlaylist()` then `addToPlaylist()` for all session-liked tracks (REQ-003, REQ-004)
- [ ] Handle `PlatformError.RATE_LIMITED` on writes: queue + exponential backoff

**Exit criteria**: Matches screen shows all liked tracks with super like distinction. End-of-session screen appears after queue is exhausted. User can save session as a playlist, view all matches, or start a new session. Regret flow removes from all destination playlists. Deleted destination playlist handled gracefully (non-blocking prompt to reassign).

---

### Phase 4 — Adapter Validation
**Goal**: Prove the interface contract is clean by running the full app against a mock adapter.

**Tasks**:
- [ ] `MockAdapter`: implements `MusicPlatformAdapter` fully with fixture data, zero real API calls
- [ ] Verify every screen works with `MockAdapter` swapped in via config flag
- [ ] Fix any leaks found (UI code that only works with Spotify-shaped data)
- [ ] Write integration test suite against the adapter interface (not against Spotify)
- [ ] Document adapter contract for future Apple Music / Tidal implementors

**Exit criteria**: Swapping `SpotifyAdapter` → `MockAdapter` in one config line requires zero changes to any UI or business logic file.

---

### Phase 5 — Hardening & Launch
**Goal**: App is stable, observable, and ready for real users.

**Tasks**:
- [ ] Wire up `PlatformDeepLink` for real: Spotify deep link opens app and activates device
- [ ] Error boundaries on all screens; graceful handling for all `PlatformError` types
- [ ] Offline detection: queue swipe events locally, flush on reconnect
- [ ] Backend: rate limiting, input validation, HTTPS only
- [ ] Sentry integration (mobile + backend)
- [ ] Expo EAS Build setup for iOS + Android
- [ ] Spotify app review submission (required before public launch)
- [ ] Basic analytics: session starts, swipes per session, match rate
- [ ] README + environment variable documentation + adapter authoring guide

**Exit criteria**: App submitted to Spotify for developer review. Builds passing on EAS. Error rates monitored. Deep link flow tested on real devices.

---

## Build-Time Unknowns

These can only be answered by measuring during development — not design decisions.

- **Spotify Playback SDK seek latency**: Does the ±20s jump feel instant enough for the tap UX, or does network latency make it feel broken on slow connections?
- **Token refresh timing**: How often do access tokens expire mid-session, and is silent refresh fast enough to be invisible?
- **Playlist pagination performance**: For 1000+ track playlists, does lazy pre-fetching cause noticeable delay before the first card appears?
- **Swipe sync failure rate**: Under poor connectivity, how often do fire-and-forget syncs fail silently, and does local-first hold up without visible inconsistency?

---

## Backend Schema (updated)

Core tables: `users`, `playlists`, `tracks`, `sessions`, `swipes`, `swipe_destinations`

- `sessions` — one row per swipe session; tracks start time, source playlist, swipe/like/super-like counts
- `swipes` — status enum: `liked | super_liked | skipped | pending`; foreign key to `sessions`
- `swipe_destinations` — join table: `swipe_id → playlist_id`; stores which playlists each swipe was written to (multi-destination aware)

---

## Design Exploration Artifacts

Decisions from exploration sessions are documented in `.planning/`:

| File | Topic |
|------|-------|
| `.planning/notes/button-bar-gesture-design.md` | Button bar layout, gesture mapping, rationale |
| `.planning/notes/decide-later-session-persistence.md` | Decide Later queue behavior, cross-session persistence, edge cases |
| `.planning/notes/end-of-session-screen.md` | End screen layout, stats, CTAs, `createPlaylist()` dependency |
| `.planning/notes/multi-destination-playlists.md` | Multi-destination model, mid-session editor scopes, data model |
| `.planning/REQUIREMENTS.md` | REQ-001 through REQ-006 with affected components |

---

## Out of Scope (for now)

- Apple Music, Tidal, YouTube Music integrations (adapter interface ready, implementations deferred)
- AI-based segment navigation / chorus detection (designed as upgrade to `SegmentNavigator` in v2)
- Social features (sharing matches, collaborative swiping)
- Push notifications
- Web version
- Offline playback / audio caching
- Spotify Free tier support (Playback SDK requires Premium)
