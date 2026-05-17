# Roadmap: MusicSwipe

## Overview

MusicSwipe is a mobile app (iOS + Android) where users connect their music platform account, pick a playlist to browse, and swipe through its tracks Tinder-style — right to like, left to skip, up to super like — while the track plays live. Liked tracks are saved to one or more destination playlists. The codebase outside the adapter layer is strictly platform-agnostic; Spotify is the sole v1 implementation.

## Phases

- [x] **Phase 1: Auth, Interface Design & Skeleton** — OAuth, adapter interface contract, playlist picker, backend scaffold
- [ ] **Phase 2: Swipe Core** — Full swipe loop: play, gesture engine, button bar, super like, decide later, multi-destination writes
- [ ] **Phase 3: Matches & Playlist Writing** — Matches screen, end-of-session screen, session playlist creation, regret/edit flows
- [ ] **Phase 4: Adapter Validation** — MockAdapter, integration test suite against adapter interface
- [ ] **Phase 5: Hardening & Launch** — Deep links, error boundaries, offline queue, EAS builds, Spotify review

## Phase Details

### Phase 1: Auth, Interface Design & Skeleton
**Goal**: Platform adapter interface fully designed and enforced. User can log in and see their playlists. Nothing plays yet.
**Depends on**: Nothing (first phase)
**Requirements**: REQ-001, REQ-003, REQ-005
**Success Criteria** (what must be TRUE):
  1. User can complete Spotify OAuth PKCE flow and tokens are stored and refreshed silently
  2. User sees their owned + followed playlists in a platform-agnostic list
  3. User can select a source playlist and one or more destination playlists (multi-select)
  4. `MusicPlatformAdapter` interface is fully typed with all methods including `saveToLibrary()` and `createPlaylist()`
  5. No file outside `src/adapters/` imports from `src/adapters/spotify/`
  6. Backend Express server is running with PostgreSQL schema (users, playlists, tracks, sessions, swipes, swipe_destinations)
**Plans**:
- Wave 1 (parallel): 01-PLAN-01 (Adapter Interface & ESLint Boundary), 01-PLAN-02 (Backend Scaffold & Schema)
- Wave 2 (blocked on Wave 1): 01-PLAN-03 (SpotifyAdapter & spotifyFetch), 01-PLAN-04 (Auth Gateway & Expo Router)
- Wave 3 (blocked on Wave 2): 01-PLAN-05 (Playlist Picker Screens)

### Phase 2: Swipe Core
**Goal**: The core swipe loop works. Track plays, user swipes, like/skip/super-like/decide-later recorded locally and synced to backend.
**Depends on**: Phase 1
**Requirements**: REQ-001, REQ-002, REQ-004, REQ-005, REQ-006
**Success Criteria** (what must be TRUE):
  1. Full swipe session works end-to-end — track plays, gestures and button bar both record swipes
  2. Super like writes to all active destination playlists AND saves to Spotify Liked Songs
  3. Decide Later tracks re-surface at front of queue on next session for the same playlist
  4. PlaylistWriter fires for all active destinations in parallel; never blocks the swipe UI
  5. Mid-session destination editor works for all three scopes (this track / from now on / entire session)
  6. Session opens on swipe start and closes on exit — SessionTracker records counts
  7. App survives a mid-session kill and resumes correctly
  8. No Spotify-specific handling in any swipe UI component
**Plans**: TBD

### Phase 3: Matches & Playlist Writing
**Goal**: Liked tracks appear in a Matches screen. End-of-session screen shows stats. User can save session as a playlist, edit matches, and remove likes.
**Depends on**: Phase 2
**Requirements**: REQ-002, REQ-003, REQ-004
**Success Criteria** (what must be TRUE):
  1. Matches screen shows all liked tracks; super liked tracks have visual distinction
  2. End-of-session screen shows album art mosaic, swiped/liked ratio, super like count, top artist
  3. "Save as playlist" CTA creates a new playlist from the session's liked + super liked tracks
  4. Regret flow removes a match from all destination playlists it was written to
  5. Edit flow allows moving a match to a different destination playlist
  6. Deleted destination playlist handled gracefully (non-blocking prompt to reassign)
**Plans**: TBD

### Phase 4: Adapter Validation
**Goal**: Prove the interface contract is clean by running the full app against a MockAdapter with zero real API calls.
**Depends on**: Phase 3
**Requirements**: None
**Success Criteria** (what must be TRUE):
  1. Swapping `SpotifyAdapter` → `MockAdapter` via one config flag requires zero changes to any UI or business logic file
  2. Every screen works with `MockAdapter` including super like, decide later, and multi-destination
  3. Integration test suite against the adapter interface passes
**Plans**: TBD

### Phase 5: Hardening & Launch
**Goal**: App is stable, observable, and ready for real users. Submitted for Spotify developer review.
**Depends on**: Phase 4
**Requirements**: None
**Success Criteria** (what must be TRUE):
  1. PlatformDeepLink opens Spotify and activates device on NO_ACTIVE_DEVICE error
  2. Error boundaries on all screens; all PlatformError types handled gracefully
  3. Swipe events queue locally and flush on reconnect after offline period
  4. EAS builds pass for iOS and Android
  5. Sentry integration active on mobile and backend
  6. App submitted to Spotify for developer review
**Plans**: TBD
