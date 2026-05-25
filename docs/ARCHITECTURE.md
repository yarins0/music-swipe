# Architecture

This document is for engineers resuming work or making structural changes. It covers the invariants, architectural decisions, and known constraints that aren't obvious from reading the code.

---

## The Adapter Boundary

The central constraint of this codebase is that **no file outside `src/adapters/` may reference anything Spotify-specific** — no Spotify types, no Spotify API strings, no Spotify imports.

All platform integrations implement the `MusicPlatformAdapter` interface. The interface defines:

- Authentication (`isAuthenticated`, `refreshAuth`, `getUserId`)
- Playlist reads (`getUserPlaylists`, `getPlaylistById`, `getPlaylistTracks`)
- Playback control (`play`, `pause`, `seek`, `getCurrentTrack`, `getCurrentPositionMs`)
- Playlist writes (`addToPlaylist`, `removeFromPlaylist`, `saveToLibrary`, `createPlaylist`)
- Deep linking (`openPlatformDeepLink`)

`spotifyFetch()` inside `src/adapters/spotify/` is the sole point of contact with the Spotify Web API. It handles silent token refresh and maps all Spotify HTTP error codes to the `PlatformError` enum before they leave the adapter layer. UI and service code only ever handles `PlatformError` values.

An ESLint rule (`no-spotify-outside-adapters`) enforces this boundary at lint time.

### Adapter capabilities

Rather than branching on `if platform === 'spotify'`, UI components read a capability flags object exposed on every adapter instance:

```
requiresExplicitFollow   — whether the user must follow a playlist before writing to it
supportsSeek             — whether the adapter supports arbitrary seek position
requiresPremium          — whether a paid subscription is required for playback
supportsLibrarySave      — whether saving to the user's library is supported
supportsPlaylistCreation — whether the adapter can create new playlists
```

This keeps platform-specific logic contained. Adding a new platform means providing a different flags object, not scattering new conditionals through the UI.

---

## Data Flow Invariants

These invariants must not be broken. They exist to keep the swipe UI responsive regardless of network or playback failures.

### Swipe events

Swipe records are written to local Zustand state immediately (optimistic). A fire-and-forget sync call goes to the backend after the fact. **Never await the sync in the swipe handler.** Local state wins on conflict. Pending sync records survive app restart via AsyncStorage persistence.

### Playlist writes

`PlaylistWriter` queues all `addToPlaylist` / `removeFromPlaylist` calls. Writes are retried with exponential backoff on `RATE_LIMITED`. The queue is persisted to AsyncStorage under `@music-swipe/playlist-write-queue` so writes survive crashes. On the next app launch, the queue is drained during the swipe screen's flush phase alongside any pending swipe sync. **Playlist writes must never block the card stack.**

### No active device

If Spotify has no active playback device at session start, `SpotifyAdapter.play()` throws `PlatformError(NO_ACTIVE_DEVICE)`. The swipe screen catches this, triggers `openPlatformDeepLink('spotify:')` (which opens the Spotify native app in the background), and shows an alert. **The swipe screen does not navigate away — the session state is preserved.**

### Decide Later tracks

Swiping "Decide Later" moves the track to an in-session pending queue. After the main pass, pending tracks get a second pass. Any still-unresolved tracks are stored as `status=pending` in the backend. On the next session for the same playlist, these are fetched and prepended to the queue before new tracks.

### Session lifecycle

- `clearSession()` is called on `session-end` screen unmount, not in `handleSessionEnd`. This keeps `pendingSyncSwipes` intact while the session-end and matches screens are mounted.
- `openSession` / `closeSession` calls to the backend are fire-and-forget from the swipe screen's perspective.

---

## Key Decisions

### Multi-destination playlists

Liked and super-liked tracks are written to all active destination playlists in parallel via `PlaylistWriter`. The primary categorization strategy is to assign tracks after the session in the Matches screen ("assign-later"), to avoid interrupting swipe flow. A mid-session destination editor at the top of the swipe screen supports users who want to adjust destinations while swiping.

### Session-end screen flow

End-of-session screen shows: album art mosaic of liked/super-liked tracks → headline ("X tracks discovered") → stats row (liked ratio, super like count, top artist computed client-side) → tiered CTAs. Top genre is deferred — it would require additional API calls per artist.

### Gesture and button mapping

Five buttons: Undo, Skip (✕), Super Like (⭐), Like (♥), Decide Later (⏱).  
Gestures: left = Skip, right = Like, up = Super Like. No swipe-down (conflicts with existing gestures).  
Tap zones on card halves wire to `SegmentNavigator` for ±20s seek.

### SegmentNavigator interface

The `SegmentNavigator` abstraction exists specifically to support a future AI-based segment detection upgrade. The seek behaviour is behind an interface so callers don't need to change when the implementation does. Do not collapse this into a direct seek call.

---

## Spotify-Specific Constraints

These are platform-level limitations that cannot be worked around:

**Unowned playlists are inaccessible.** The Spotify Web API returns only playlists the authenticated user owns or follows. If a user wants to use a playlist they don't own as a source or destination, they must follow it in Spotify first. There is no workaround — this is enforced by Spotify's API permission model.

**Development mode user limit.** While the Spotify app is in development mode (pre-Extended Quota approval), only manually added users can log in. The limit is 25 users. Users are added via the Spotify Developer Dashboard under Settings → User Management. Applying for Extended Quota removes this restriction.

**Playback requires Premium.** The Spotify Web Playback SDK and `/me/player/play` endpoint require a Spotify Premium account. The adapter's `requiresPremium` capability flag is set to `true`; the UI should gate the swipe session on this before attempting playback.

---

## Adding a New Platform

1. Create `src/adapters/<platform>/` with an adapter class implementing `MusicPlatformAdapter`.
2. Map all platform-specific errors to `PlatformError` before they leave the adapter.
3. Set `capabilities` accurately — do not inherit Spotify's flags blindly.
4. Add a complete implementation to `MockAdapter` for the new methods before merging.
5. The ESLint rule will prevent platform-specific leakage automatically.

No changes to UI or service code should be required unless a new capability flag is needed.

---

## Testing

The `MockAdapter` in `src/adapters/mock/` is a full fixture-based implementation of `MusicPlatformAdapter`. It is the only adapter used in tests — no Spotify credentials, no network. Any new method added to the interface must be implemented in `MockAdapter` before the PR merges; the adapter contract test suite enforces this.

The eslint rule `no-spotify-outside-adapters` is tested independently in `eslint-rules/__tests__/`.
