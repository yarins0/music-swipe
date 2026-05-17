# Phase 1: Auth, Interface Design & Skeleton - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 1-auth-interface-design-skeleton
**Areas discussed:** Token storage & refresh, Playlist picker UX, Backend auth & structure

---

## Token Storage & Refresh

| Option | Description | Selected |
|--------|-------------|----------|
| Expo SecureStore | iOS Keychain + Android Keystore, hardware-backed | ✓ |
| AsyncStorage | Unencrypted, not appropriate for OAuth tokens | |
| MMKV + encryption | Fast, can be encrypted, overkill for auth tokens | |

**User's choice:** Expo SecureStore

---

| Option | Description | Selected |
|--------|-------------|----------|
| Proactive only | Refresh ~5 min before expiry in the background | |
| Reactive only | spotifyFetch() catches 401, refreshes, retries | |
| Both — proactive + reactive fallback | Proactive attempt; reactive catch for missed windows | ✓ |

**User's choice:** Both (proactive + reactive fallback)
**Notes:** User initially questioned why Option 1 was recommended over Option 3. Discussed that mobile OS background suspension makes proactive-only unreliable; the reactive fallback is the safety net. User agreed Option 3 is better.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Silent logout + redirect to login | Clear tokens, reset state, navigate automatically | ✓ |
| Error screen with manual logout | Show error, let user tap to re-login | |
| Retry once, then silent logout | Attempt fresh auth before giving up | |

**User's choice:** Silent logout + redirect to login

---

## Playlist Picker UX

| Option | Description | Selected |
|--------|-------------|----------|
| Flat list, alphabetical | No grouping | |
| Two sections: Owned then Followed | Clear separation, Liked Songs pinned at top | ✓ |
| Recently played first | Requires session tracking history | |

**User's choice:** Two sections — Liked Songs always at top of "My Playlists"

---

| Option | Description | Selected |
|--------|-------------|----------|
| Checkboxes in scrollable list | Tap to toggle, Confirm button at bottom | ✓ |
| Chips / pills | More visual, harder to scan for long lists | |
| Two-panel picker | Complex UX for v1 | |

**User's choice:** Checkboxes in scrollable list (destination)

---

**Source empty state (freeform response):**
User noted: Liked Songs should always be present. If it's the only item, nudge to follow playlists in Spotify. URL/playlist ID paste should work for any public playlist. Must account for Spotify API blocking access to unowned playlists (PlaylistAccessGuard handles this).

| Option | Description | Selected |
|--------|-------------|----------|
| Create new playlist inline | "+" option, calls createPlaylist() | ✓ |
| Message + open Spotify | Redirect to Spotify to create | |
| Message only | No action | |

**User's choice:** Create new playlist inline (destination empty state)

---

**URL paste scope:**

| Option | Description | Selected |
|--------|-------------|----------|
| Source only | Destination requires ownership to write | ✓ |
| Both source and destination | Extra validation needed | |

**User's choice:** Source only

---

## Backend Auth & Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase Auth | Mobile authenticates to Supabase, Supabase issues JWT, Express verifies | ✓ |
| Backend issues own JWT | Mobile sends Spotify token once, backend issues custom JWT | |
| Spotify token as API credential | Backend validates Spotify token on every request | |

**User's choice:** Supabase Auth

---

| Option | Description | Selected |
|--------|-------------|----------|
| Direct from mobile | Mobile holds tokens, calls Spotify directly | ✓ |
| Proxy through backend | All Spotify calls routed through Express | |

**User's choice:** Direct from mobile
**Notes:** User asked for pros/cons comparison. Key deciding factors: Playback SDK requires token on client anyway; proxying adds latency to every play/pause/seek; backend IPs could be rate-limited across all users.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Railway | Dead-simple Node.js, $5/mo | |
| Render | Similar to Railway | ✓ |
| Fly.io | More control, steeper learning curve | |

**User's choice:** Render

---

## Claude's Discretion

- Exact SecureStore key naming convention
- Express middleware stack setup (body-parser, cors, helmet)
- Supabase client initialisation pattern
- ESLint rule implementation for no-cross-adapter-imports
- Folder structure within `src/adapters/spotify/`

## Deferred Ideas

- **Search within playlist list** — filter by name; adds scope, deferred
- **Recently played ordering** — requires session history from Phase 2+
- **URL paste for destination** — decided source-only; won't do (Spotify permission constraints)
