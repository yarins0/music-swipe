# Requirements

Requirements that emerged from design exploration sessions. Each has a unique ID for cross-referencing.

---

## REQ-005 — Multi-destination playlist support

**Source:** Exploration — multi-destination playlists (2026-05-15)

Destination is multi-select. A liked or super liked track is written to all currently active destination playlists simultaneously. `PlaylistWriter` must support parallel writes to N playlists per like event.

Each swipe record must store the list of destination playlist IDs the track was actually written to (not a single ID), since per-track overrides can differ from the session default.

**Affected components:** Destination playlist picker screen, `PlaylistWriter`, `SwipeEngine`, backend schema (`matches` table or join table)

---

## REQ-006 — Mid-session destination editor

**Source:** Exploration — multi-destination playlists (2026-05-15)

A secondary edit control (not in the main button bar) on the swipe screen allows changing destination playlists mid-session. Three scopes:

- **This track** — one-off override for the current track before swiping
- **From now on** — changes session default for all future likes
- **Entire session** — retroactive: adding a playlist silently adds all session-liked tracks; removing a playlist prompts "Remove these X tracks from [playlist]?" before acting

The prompt only fires on removal (destructive action). Addition is always silent.

**Affected components:** Swipe screen UI, `SwipeEngine`, `PlaylistWriter`, backend session query

---

## REQ-003 — `createPlaylist()` on MusicPlatformAdapter

**Source:** Exploration — end-of-session screen (2026-05-15)

The `MusicPlatformAdapter` interface must include a `createPlaylist(name: string): Promise<string>` method (returns the new playlist ID). Used by the end-of-session "Save as playlist" CTA to create a session playlist from the current session's liked + super liked tracks.

A `supportsPlaylistCreation: boolean` capability flag must accompany it. Adapters that cannot create playlists should return `false` and the CTA should be hidden for those users.

**Affected components:** `MusicPlatformAdapter`, `SpotifyAdapter`, `MockAdapter`, `PlaylistWriter`

---

## REQ-004 — Sessions table for per-session track tracking

**Source:** Exploration — end-of-session screen (2026-05-15)

The backend needs a `sessions` table (or equivalent) that records which tracks were liked and super liked within a specific swipe session. This data powers:

- The end-screen album art mosaic (this session's likes only)
- "Save as playlist" CTA (creates a playlist from this session's tracks)
- Per-session stats (swiped count, liked count, super liked count, top artist)

A session starts when a user begins swiping a playlist and ends when they exit or exhaust the queue. Session ID should be stored alongside swipe records.

**Affected components:** Backend schema, `SwipeEngine`, end-of-session screen

---

## REQ-001 — `saveToLibrary()` on MusicPlatformAdapter

**Source:** Exploration — button bar & Super Like design (2026-05-15)

The `MusicPlatformAdapter` interface must include a `saveToLibrary(trackId: string): Promise<void>` method for adding a track to the user's native music library (e.g., Spotify Liked Songs via `PUT /me/tracks`).

A corresponding capability flag `supportsLibrarySave: boolean` must be added to the adapter interface. Adapters that do not support a native library concept should return `false` and no-op on `saveToLibrary()`.

**Super Like behavior depends on this:** Super Like calls both `addToPlaylist()` and `saveToLibrary()`.

**Affected components:** `MusicPlatformAdapter`, `SpotifyAdapter`, `MockAdapter`, `PlaylistWriter`

---

## REQ-002 — Swipe status enum includes `super_liked` and `pending`

**Source:** Exploration — button bar & Super Like design (2026-05-15)

The `swipes` table status column must be a four-value enum:

```
liked | super_liked | skipped | pending
```

- `super_liked` — track was super liked; visible in Matches screen with visual distinction
- `pending` — track was "Decide Later"'d; does NOT appear in Matches; re-surfaces at front of queue on next session for the same playlist

**Affected components:** Backend schema, `SwipeEngine`, `MatchesStore`, `PlaylistResolver`
