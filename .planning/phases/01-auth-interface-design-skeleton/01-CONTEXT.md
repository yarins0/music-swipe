# Phase 1: Auth, Interface Design & Skeleton - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver: OAuth PKCE login flow, token storage, Spotify adapter interface contract (fully typed), playlist picker screens (source + destination), and Express/Supabase backend scaffold. Nothing plays yet.

Exit criteria: user logs in → sees their playlists → picks a source (or pastes a URL) → picks one or more destination playlists. Adapter interface is typed and enforced. No file outside `src/adapters/` imports from `src/adapters/spotify/`.

</domain>

<decisions>
## Implementation Decisions

### Token Storage
- **D-01:** Tokens stored in **Expo SecureStore** (iOS Keychain + Android Keystore — hardware-backed). Both access token and refresh token stored here. Never AsyncStorage.
- **D-02:** **Dual refresh strategy** — proactive refresh ~5 min before expiry (background) PLUS reactive fallback: `spotifyFetch()` catches any 401, refreshes once, retries the original request. Mobile OS background suspension makes proactive-only unreliable; the reactive fallback is the safety net.
- **D-03:** If refresh token is expired or revoked (e.g., user revoked app access in Spotify settings): **silent logout** — clear stored tokens, reset auth state, navigate to login screen automatically. No error screen shown.

### Playlist Picker — Source
- **D-04:** Source picker shows two sections: **"My Playlists"** (owned, alphabetical within section) then **"Following"** (followed but not owned, alphabetical). Liked Songs always appears at the very top of "My Playlists" as a sentinel item with a distinct icon — it is always present for any Spotify user.
- **D-05:** **Liked Songs adapter handling** — `getUserPlaylists()` returns Liked Songs as a synthetic item with a sentinel ID (e.g., `spotify:collection:tracks`). `getPlaylistTracks()` routes to `GET /me/tracks` when it sees this ID instead of the standard playlist endpoint.
- **D-06:** **URL / playlist ID paste** — source picker includes a paste/search field that accepts any Spotify playlist URL or playlist ID. Lets users swipe any public playlist without following it first. `PlaylistAccessGuard` reads the `requiresExplicitFollow` capability flag and shows the follow-first onboarding if the API requires it. **Source only** — URL paste is not available in the destination picker.
- **D-07:** Source **empty state** (only Liked Songs visible, no other playlists): show Liked Songs plus a nudge: "Browse Spotify to discover playlists to follow." No blocking gate — user can still swipe Liked Songs.

### Playlist Picker — Destination
- **D-08:** Destination picker uses **checkboxes in a scrollable list** with a "Confirm" button at the bottom. Multi-select — user can select any number of owned playlists. Tapping a row toggles the checkbox.
- **D-09:** Destination **empty state** (no owned playlists): show a **"+ New playlist"** option at the top of the list. Tapping it calls `createPlaylist()` on the adapter inline — name input prompt, then the newly created playlist is pre-selected and added to the list. No redirect to Spotify needed.

### Backend Auth
- **D-10:** **Supabase Auth** handles user identity. After Spotify OAuth completes on device, mobile authenticates to Supabase (passing the Spotify token to link accounts). Supabase issues a JWT. The Express API verifies Supabase JWTs on every request — no custom JWT issuance.
- **D-11:** **Mobile calls Spotify directly** (not proxied through backend). Mobile holds Spotify tokens in SecureStore and calls the Spotify Web API and Playback SDK directly. The backend never sees Spotify tokens. Backend responsibilities: user records, swipe sync, session tracking, matches CRUD.
- **D-12:** Backend hosted on **Render** (v1). Auto-deploys from GitHub. PostgreSQL on Supabase.

### Claude's Discretion
- Exact SecureStore key naming convention
- Express middleware stack (body-parser, cors, helmet setup)
- Supabase client initialisation pattern on both mobile and backend
- ESLint rule implementation for the no-cross-adapter-imports constraint
- Exact folder structure within `src/adapters/spotify/`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Architecture & Decisions
- `PLAN.md` — full system architecture, System Components table, adapter interface design, all phase tasks and exit criteria. Primary reference for this phase.
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and requirement IDs

### Requirements
- `.planning/REQUIREMENTS.md` — REQ-001 (`saveToLibrary()`), REQ-003 (`createPlaylist()`), REQ-005 (multi-destination support) — all three are in Phase 1 scope for interface design
- `.planning/notes/multi-destination-playlists.md` — destination picker design, mid-session editor scopes, data model implications (Phase 2 execution, but adapter interface must account for it)

### Phase 2 Forward-References (interface must be designed for these)
- `.planning/notes/button-bar-gesture-design.md` — super like, decide later — the adapter methods needed are defined in Phase 1
- `.planning/notes/decide-later-session-persistence.md` — `pending` swipe status, how PlaylistResolver must handle it
- `.planning/notes/end-of-session-screen.md` — `createPlaylist()` used in Phase 3 end screen; interface must be ready

No external ADRs or third-party specs — requirements fully captured in decisions and notes above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None yet — greenfield project. Phase 1 establishes all foundational patterns.

### Established Patterns (to define in Phase 1)
- `MusicPlatformAdapter` interface — the single most important architectural pattern. Every subsequent phase builds on it. Define it to be exhaustive: include all methods (including `saveToLibrary`, `createPlaylist`, `getUserPlaylists` with Liked Songs sentinel, `getPlaylistTracks` with routing logic) and all capability flags (`requiresExplicitFollow`, `supportsSeek`, `requiresPremium`, `supportsLibrarySave`, `supportsPlaylistCreation`).
- `spotifyFetch()` helper — internal to `SpotifyAdapter`. Centralises token injection, proactive refresh trigger, 401 catch-and-retry, and error normalisation to `PlatformError`.
- `PlatformError` enum — every adapter error must map to a value in this enum. Define all values needed through Phase 5 now; it is the contract.

### Integration Points
- Supabase client shared between mobile and backend (different SDK versions: `@supabase/supabase-js` on mobile, same on backend). Auth JWT verification on backend via Supabase middleware.
- Expo AuthSession → Spotify PKCE flow → SecureStore token persistence → `spotifyFetch()` usage.

</code_context>

<specifics>
## Specific Ideas

- **Liked Songs sentinel ID**: `spotify:collection:tracks` — `getPlaylistTracks()` detects this and routes to `GET /me/tracks` with pagination.
- **Dual refresh in spotifyFetch()**: proactive refresh is triggered by a stored `expiresAt` timestamp (persisted to SecureStore alongside the tokens). If `Date.now() >= expiresAt - 5 * 60 * 1000`, refresh before making the call. If the call still returns 401 (missed refresh window or clock drift), refresh and retry once.
- **No-cross-adapter lint rule**: ESLint rule or path alias configured so that any `import from 'adapters/spotify'` or `import from '../adapters/spotify'` outside the `src/adapters/` directory throws a lint error. Enforces the platform-agnostic boundary at commit time.

</specifics>

<deferred>
## Deferred Ideas

- **Search within playlist list** — filter playlists by name in the picker. Useful for large libraries but adds scope; Phase 1 can ship with scroll only.
- **Recently played ordering** — surface recently swiped playlists first. Requires session history; deferred to post-Phase 2 when session data exists.
- **URL paste for destination** — user asked about this; decided source-only. If a user wants to write to a playlist they don't own, that's a Spotify permission problem. Deferred/won't do.

</deferred>

---

*Phase: 1-auth-interface-design-skeleton*
*Context gathered: 2026-05-15*
