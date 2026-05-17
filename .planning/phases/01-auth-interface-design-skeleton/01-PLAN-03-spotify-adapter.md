---
id: 01-PLAN-03
title: SpotifyAdapter & spotifyFetch
wave: 2
depends_on:
  - 01-PLAN-01
files_modified:
  - src/adapters/spotify/SpotifyAdapter.ts
  - src/adapters/spotify/spotifyFetch.ts
  - src/adapters/spotify/mappers.ts
autonomous: true
requirements_addressed:
  - REQ-001
  - REQ-003
  - REQ-005
---

# Plan 03: SpotifyAdapter & spotifyFetch

## Objective

Implement `SpotifyAdapter` (the sole Spotify implementation of `MusicPlatformAdapter`) and the internal `spotifyFetch()` helper with proactive + reactive token refresh. Include all methods defined in the interface. Playback methods (`play`, `pause`, `seek`, etc.) are stubbed with `throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE)` — they will be implemented in Phase 2.

**Boundary rule:** No file outside `src/adapters/` may import from `src/adapters/spotify/`. This plan creates files inside the boundary.

## Tasks

<task id="T03-01">
<title>Create src/adapters/spotify/mappers.ts</title>

<read_first>
- src/adapters/interface.ts (Track, Playlist interfaces)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 6 — Spotify API response shapes)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-04, D-05 — playlist sections, Liked Songs)
</read_first>

<action>
Create src/adapters/spotify/mappers.ts with pure mapping functions (no API calls):

1. `mapSpotifyTrack(item: SpotifyTrackItem): Track` — maps a Spotify track object to the internal Track type:
   - id = item.track.id
   - uri = item.track.uri
   - title = item.track.name
   - artist = item.track.artists[0].name
   - artists = item.track.artists.map(a => a.name)
   - album = item.track.album.name
   - albumArtUrl = item.track.album.images[0]?.url ?? ''
   - durationMs = item.track.duration_ms
   - previewUrl = item.track.preview_url

2. `mapSpotifyPlaylist(item: SpotifyPlaylistItem, currentUserId: string): Playlist` — maps a Spotify playlist object:
   - id = item.id
   - name = item.name
   - coverArtUrl = item.images[0]?.url ?? null
   - trackCount = item.tracks.total
   - isOwned = item.owner.id === currentUserId
   - isFollowed = item.owner.id !== currentUserId

3. Define local TypeScript interfaces for Spotify API response shapes (SpotifyTrackItem, SpotifyPlaylistItem, etc.) within this file — these are internal to the adapter.
</action>

<acceptance_criteria>
- src/adapters/spotify/mappers.ts exists
- mapSpotifyPlaylist sets isOwned = true when item.owner.id matches currentUserId
- mapSpotifyPlaylist sets isOwned = false and isFollowed = true when owner differs
- mapSpotifyTrack sets artists as an array (not a single string)
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T03-02">
<title>Create src/adapters/spotify/spotifyFetch.ts</title>

<read_first>
- src/adapters/interface.ts (PlatformError, PlatformErrorCode)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 3 — spotifyFetch architecture, Section 3 refreshSpotifyToken)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-02 dual refresh, D-03 silent logout on expired refresh token)
</read_first>

<action>
Create src/adapters/spotify/spotifyFetch.ts with:

1. `SpotifyAuthContext` interface: { accessToken: string; refreshToken: string; expiresAt: number; onTokenRefreshed: (newToken: string, newExpiresAt: number) => Promise<void>; onAuthExpired: () => Promise<void> }

2. `refreshSpotifyToken(auth: SpotifyAuthContext): Promise<string>`:
   - POST to https://accounts.spotify.com/api/token
   - Body: grant_type=refresh_token, refresh_token=auth.refreshToken, client_id=SPOTIFY_CLIENT_ID (from env)
   - On success: call auth.onTokenRefreshed(newAccessToken, Date.now() + expiresIn * 1000), return newAccessToken
   - On 400 or invalid_grant: call auth.onAuthExpired(), throw PlatformError(AUTH_EXPIRED)

3. `mapHttpError(status: number, body: any): never`:
   - 401 → throw PlatformError(AUTH_EXPIRED)
   - 403 → throw PlatformError(PERMISSION_DENIED)
   - 404 → throw PlatformError(NOT_FOUND)
   - 429 → throw PlatformError(RATE_LIMITED)
   - default → throw PlatformError(UNKNOWN)

4. `spotifyFetch(endpoint: string, options: RequestInit, auth: SpotifyAuthContext): Promise<any>`:
   - Step 1: Proactive refresh if Date.now() >= auth.expiresAt - 5 * 60 * 1000
   - Step 2: Fetch https://api.spotify.com/v1${endpoint} with Authorization: Bearer {current token}
   - Step 3: If 401 response → refreshSpotifyToken → retry once
   - Step 4: If retry is also 401 → call auth.onAuthExpired(), throw PlatformError(AUTH_EXPIRED)
   - Step 5: If other non-2xx → mapHttpError
   - Step 6: Return response.json()

SPOTIFY_CLIENT_ID must be read from process.env or a config constant — not hardcoded.
</action>

<acceptance_criteria>
- src/adapters/spotify/spotifyFetch.ts exports spotifyFetch and SpotifyAuthContext
- spotifyFetch calls onAuthExpired when refresh token is invalid (double 401 scenario)
- spotifyFetch refreshes proactively when within 5 minutes of expiresAt
- 429 response maps to PlatformError with code RATE_LIMITED
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T03-03">
<title>Create src/adapters/spotify/SpotifyAdapter.ts</title>

<read_first>
- src/adapters/interface.ts (MusicPlatformAdapter, all types)
- src/adapters/spotify/spotifyFetch.ts
- src/adapters/spotify/mappers.ts
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Sections 5, 6, 7 — interface, API endpoints, pagination)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-04 through D-09 — picker behavior, Liked Songs sentinel)
</read_first>

<action>
Create src/adapters/spotify/SpotifyAdapter.ts implementing MusicPlatformAdapter:

Constructor: takes SpotifyAuthContext as argument.

capabilities (readonly AdapterCapabilities):
- requiresExplicitFollow: false (Spotify allows pasting any public playlist URL)
- supportsSeek: true
- requiresPremium: true (Spotify streaming requires Premium)
- supportsLibrarySave: true
- supportsPlaylistCreation: true

Implement these methods fully:

**getUserId()**: GET /me → return data.id

**getUserPlaylists()**: 
- Fetch currentUserId from getUserId()
- Paginate GET /me/playlists?limit=50 until data.next is null
- Map all items using mapSpotifyPlaylist(item, currentUserId)
- Get Liked Songs count: GET /me/tracks?limit=1 → total
- Prepend a synthetic Liked Songs Playlist object:
  { id: LIKED_SONGS_PLAYLIST_ID, name: 'Liked Songs', coverArtUrl: null, trackCount: likedSongsTotal, isOwned: true, isFollowed: false }
- Return: [likedSongs, ...allPlaylistItems]
- Note: LIKED_SONGS_PLAYLIST_ID is imported from src/adapters/interface.ts (NOT from within spotify/)

**getPlaylistById(playlistId)**:
- If playlistId === LIKED_SONGS_PLAYLIST_ID: call getUserPlaylists(), return the first item
- Else: GET /playlists/{playlistId} → mapSpotifyPlaylist

**getPlaylistTracks(playlistId, offset = 0, limit = 50)**:
- If playlistId === LIKED_SONGS_PLAYLIST_ID: GET /me/tracks?offset={offset}&limit={limit}
- Else: GET /playlists/{playlistId}/tracks?offset={offset}&limit={limit}
- Map items using mapSpotifyTrack
- Return { tracks, total: data.total }

**addToPlaylist(playlistId, trackId)**:
- POST /playlists/{playlistId}/tracks with body { uris: ['spotify:track:{trackId}'] }

**removeFromPlaylist(playlistId, trackId)**:
- DELETE /playlists/{playlistId}/tracks with body { tracks: [{ uri: 'spotify:track:{trackId}' }] }

**saveToLibrary(trackId)** (REQ-001):
- PUT /me/tracks with body { ids: [trackId] }

**createPlaylist(name)** (REQ-003):
- First: getUserId() to get current user ID
- POST /users/{userId}/playlists with body { name, public: false }
- Return the new playlist ID from response.id

**Playback stubs** (play, pause, seek, getCurrentTrack, getCurrentPositionMs):
- All throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'Playback not implemented in Phase 1')

**openPlatformDeepLink(uri)**:
- throw new PlatformError(PlatformErrorCode.UNKNOWN, 'Deep links not implemented until Phase 5')

**isAuthenticated()**: return Boolean(auth.accessToken && auth.expiresAt > Date.now())
**refreshAuth()**: call refreshSpotifyToken(auth)
</action>

<acceptance_criteria>
- src/adapters/spotify/SpotifyAdapter.ts implements MusicPlatformAdapter (TypeScript verifies all methods present)
- SpotifyAdapter.getUserPlaylists() returns Liked Songs as the first item in the array (id === 'spotify:collection:tracks')
- SpotifyAdapter.getPlaylistTracks('spotify:collection:tracks') calls /me/tracks endpoint
- SpotifyAdapter.saveToLibrary() calls PUT /me/tracks (REQ-001 fulfilled)
- SpotifyAdapter.createPlaylist() calls POST /users/{id}/playlists and returns the new playlist ID (REQ-003 fulfilled)
- `npx tsc --noEmit` exits 0 — TypeScript confirms all MusicPlatformAdapter methods are implemented
- No import from src/adapters/spotify/ anywhere outside src/adapters/ (ESLint rule passes)
</acceptance_criteria>
</task>

## Verification

<verification>
### Goal-Backward Check
Phase 1 success criteria 4 and 5: adapter interface implemented and boundary enforced.
REQ-001 (saveToLibrary), REQ-003 (createPlaylist), REQ-005 (multi-destination writes use addToPlaylist per destination).

### Verification Commands
```bash
npx tsc --noEmit    # TypeScript must confirm SpotifyAdapter implements MusicPlatformAdapter
npx expo lint       # ESLint boundary rule must pass
```
</verification>

<must_haves>
truths:
  - SpotifyAdapter implements every method in MusicPlatformAdapter without TypeScript errors
  - getUserPlaylists() prepends Liked Songs sentinel as first item
  - getPlaylistTracks() branches on LIKED_SONGS_PLAYLIST_ID to call /me/tracks
  - spotifyFetch() has both proactive (5-min window) and reactive (401 catch-retry) refresh paths
  - saveToLibrary() and createPlaylist() are fully implemented (not stubs)
</must_haves>
