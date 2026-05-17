## RESEARCH COMPLETE

# Phase 1 Research: Auth, Interface Design & Skeleton

**Researched:** 2026-05-15
**Phase requirements addressed:** REQ-001, REQ-003, REQ-005
**Status:** Ready for planning

---

## 1. Expo AuthSession + Spotify PKCE

### Implementation Pattern

Spotify's PKCE flow maps directly onto Expo's `AuthSession.useAuthRequest` hook.

```ts
// src/auth/useSpotifyAuth.ts
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const scopes = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',     // for saveToLibrary()
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
];
```

**Redirect URI setup is critical:**
- Bare/dev: `AuthSession.makeRedirectUri({ scheme: 'MusicSwipe' })`
- Expo Go: `AuthSession.makeRedirectUri({ useProxy: true })`
- All three must be registered in the Spotify Developer Dashboard

**app.json / app.config.ts** must include:
```json
{
  "expo": {
    "scheme": "MusicSwipe",
    "ios": { "bundleIdentifier": "com.yourcompany.MusicSwipe" },
    "android": { "package": "com.yourcompany.MusicSwipe" }
  }
}
```

**useAuthRequest flow:**
```ts
const [request, response, promptAsync] = AuthSession.useAuthRequest(
  {
    clientId: SPOTIFY_CLIENT_ID,
    scopes,
    usePKCE: true,
    redirectUri,
  },
  discovery
);
```
- `usePKCE: true` handles code_verifier/code_challenge generation automatically
- On success, `response.type === 'success'` and `response.params.code` is the auth code
- Token exchange must happen immediately after: POST to `discovery.tokenEndpoint` with `grant_type: authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`

**Token exchange returns:**
```ts
{
  access_token: string,
  refresh_token: string,
  expires_in: number, // seconds, typically 3600
  token_type: 'Bearer'
}
```
Store `expiresAt = Date.now() + (expires_in * 1000)` alongside the tokens.

---

## 2. Expo SecureStore — Token Storage

### Key Naming Convention (Claude's Discretion — recommended)
```
spotify_access_token
spotify_refresh_token
spotify_expires_at        // stored as ISO string or ms timestamp string
```

### Read/Write Pattern
```ts
import * as SecureStore from 'expo-secure-store';

// Write
await SecureStore.setItemAsync('spotify_access_token', token);
await SecureStore.setItemAsync('spotify_expires_at', String(expiresAt));

// Read (returns null if not set)
const token = await SecureStore.getItemAsync('spotify_access_token');
if (!token) { /* first launch or logged out — redirect to login */ }
```

**Important constraints:**
- SecureStore is async-only — never use synchronously
- Max value size: 2048 bytes — tokens are well within this
- Not available in Expo Go for certain devices — dev must fall back gracefully
- On Android, requires `KEYSTORE` permission (included in Expo defaults)
- Keys must be alphanumeric + `_` — no special characters

### Auth State Init (app startup)
On app launch, check `spotify_access_token` and `spotify_expires_at`. If both present: consider logged in. If missing: route to login. Initialize `AuthGateway` Zustand store from these values.

---

## 3. Token Refresh Strategy (D-02)

### spotifyFetch() Architecture

This is the single place that calls Spotify. All adapter methods funnel through it.

```ts
// src/adapters/spotify/spotifyFetch.ts
async function spotifyFetch(
  endpoint: string,
  options: RequestInit,
  authStore: AuthStore
): Promise<Response> {
  // 1. Proactive refresh: if within 5 min of expiry, refresh first
  const { accessToken, expiresAt, refreshToken } = authStore.getState();
  if (Date.now() >= expiresAt - 5 * 60 * 1000) {
    await refreshSpotifyToken(refreshToken, authStore);
  }

  // 2. Make request with current (possibly just-refreshed) access token
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${authStore.getState().accessToken}`,
    },
  });

  // 3. Reactive fallback: 401 means token was invalid despite refresh
  if (res.status === 401) {
    await refreshSpotifyToken(refreshToken, authStore);
    const retryRes = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${authStore.getState().accessToken}`,
      },
    });
    if (retryRes.status === 401) {
      // Refresh token itself is expired/revoked — silent logout (D-03)
      authStore.getState().clearAuth();
      throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
    }
    return retryRes;
  }

  // 4. Map HTTP errors to PlatformError
  return mapHttpErrorToPlatformError(res);
}
```

### refreshSpotifyToken()
POST to `https://accounts.spotify.com/api/token` with:
- `grant_type: refresh_token`
- `refresh_token: <stored>`
- `client_id: <SPOTIFY_CLIENT_ID>`
- No client_secret for PKCE flows

On success: update `accessToken`, `expiresAt` in SecureStore and Zustand store.
On 400/invalid_grant: silent logout (D-03).

---

## 4. Supabase Auth Integration (D-10, D-11)

### Strategy: Supabase as Identity Layer Only

Mobile authenticates to Supabase **after** completing the Spotify OAuth PKCE flow. The Spotify access token is **not** passed to Supabase — Supabase issues its own JWT purely for identifying the user and securing Express endpoints.

**Flow:**
1. Complete Spotify PKCE → have Spotify `access_token` + `refresh_token`
2. Get Spotify user ID: `GET /me` → `spotify_user_id`
3. Sign in to Supabase via email+password derived from user (or use Supabase anonymous sign-in, then link with a deterministic email like `{spotify_user_id}@MusicSwipe.internal`)
4. Better approach: use `supabase.auth.signInWithIdToken()` if Supabase supports it, OR use the **Supabase custom token** approach with a server-side function

**Recommended Pattern (simplest for v1):**
- On first login: call a backend endpoint `POST /auth/register` with the Spotify access token
- Backend verifies with Spotify `/me`, creates a user record, returns a Supabase JWT (via `supabase.auth.admin.createUser()` + `supabase.auth.admin.generateLink()`)
- Mobile stores the Supabase JWT in SecureStore
- All Express endpoints verify the Supabase JWT via `supabase.auth.getUser(jwt)`

```ts
// backend: Express middleware
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.userId = user.id;
  next();
}
```

**Key point:** Backend NEVER handles Spotify tokens. It only verifies Supabase JWTs.

---

## 5. MusicPlatformAdapter Interface

### Complete Interface (must be defined exhaustively in Phase 1)

```ts
// src/adapters/interface.ts

export enum PlatformErrorCode {
  NO_ACTIVE_DEVICE = 'NO_ACTIVE_DEVICE',
  PREMIUM_REQUIRED = 'PREMIUM_REQUIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PLAYLIST_NOT_FOUND = 'PLAYLIST_NOT_FOUND',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class PlatformError extends Error {
  constructor(public readonly code: PlatformErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PlatformError';
  }
}

export interface Track {
  id: string;               // platform-specific track ID
  uri: string;              // platform URI (e.g., spotify:track:xxx)
  title: string;
  artist: string;           // primary artist name
  artists: string[];        // all artist names
  album: string;
  albumArtUrl: string;
  durationMs: number;
  previewUrl: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  coverArtUrl: string | null;
  trackCount: number;
  isOwned: boolean;          // true = user's own playlist
  isFollowed: boolean;       // true = followed but not owned
}

export interface AdapterCapabilities {
  requiresExplicitFollow: boolean;     // must follow before accessing playlist
  supportsSeek: boolean;               // can seek within track
  requiresPremium: boolean;            // premium subscription required for playback
  supportsLibrarySave: boolean;        // supports saveToLibrary()
  supportsPlaylistCreation: boolean;   // supports createPlaylist()
}

export interface MusicPlatformAdapter {
  // Capabilities
  readonly capabilities: AdapterCapabilities;

  // Auth
  isAuthenticated(): Promise<boolean>;
  refreshAuth(): Promise<void>;

  // User
  getUserId(): Promise<string>;

  // Playlists
  getUserPlaylists(): Promise<Playlist[]>;
  // Note: includes Liked Songs sentinel (id = 'spotify:collection:tracks')
  getPlaylistById(playlistId: string): Promise<Playlist>;

  // Tracks
  getPlaylistTracks(playlistId: string, offset?: number, limit?: number): Promise<{ tracks: Track[]; total: number; }>;
  // Note: routes to GET /me/tracks when playlistId is Liked Songs sentinel

  // Playback (Phase 2 methods — interface defined now, implemented in Phase 2)
  play(trackUri: string): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getCurrentTrack(): Promise<Track | null>;
  getCurrentPositionMs(): Promise<number>;

  // Writes
  addToPlaylist(playlistId: string, trackId: string): Promise<void>;
  removeFromPlaylist(playlistId: string, trackId: string): Promise<void>;
  saveToLibrary(trackId: string): Promise<void>;       // REQ-001: saves to Liked Songs
  createPlaylist(name: string): Promise<string>;        // REQ-003: returns new playlist ID

  // Platform navigation
  openPlatformDeepLink(uri: string): Promise<void>;    // Phase 5 stub in Phase 1
}
```

**Liked Songs Sentinel:**
```ts
export const LIKED_SONGS_PLAYLIST_ID = 'spotify:collection:tracks';
```
`getPlaylistTracks()` must check for this sentinel and route to `GET /me/tracks` instead of `GET /playlists/{id}/tracks`.

---

## 6. Spotify Playlist API — Key Endpoints

### GET /me/playlists (paginated)
```
GET https://api.spotify.com/v1/me/playlists?limit=50&offset=0
Authorization: Bearer {access_token}
```
Returns up to 200 playlists across pages (limit 50 per page). Response:
```json
{
  "items": [{ "id": "...", "name": "...", "owner": { "id": "..." }, "images": [...], "tracks": { "total": N } }],
  "next": "https://...", // null if last page
  "total": N
}
```
`isOwned` = `item.owner.id === currentUserId`
`isFollowed` = !isOwned (items in this endpoint are always either owned or explicitly followed)

### Liked Songs Sentinel Construction
```ts
const likedSongs: Playlist = {
  id: LIKED_SONGS_PLAYLIST_ID,
  name: 'Liked Songs',
  coverArtUrl: null, // no cover art — use local heart icon
  trackCount: await getLikedSongsCount(), // GET /me/tracks?limit=1 → total
  isOwned: true,
  isFollowed: false,
};
```

### GET /me/playlists — Pagination Pattern
```ts
async function fetchAllPlaylists(spotifyFetch): Promise<Playlist[]> {
  const playlists: Playlist[] = [];
  let url = '/me/playlists?limit=50';
  while (url) {
    const res = await spotifyFetch(url, {});
    const data = await res.json();
    playlists.push(...data.items.map(mapPlaylist));
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return playlists;
}
```

### GET /playlists/{id}/tracks vs GET /me/tracks
```ts
// src/adapters/spotify/SpotifyAdapter.ts
async getPlaylistTracks(playlistId, offset = 0, limit = 50) {
  const endpoint = playlistId === LIKED_SONGS_PLAYLIST_ID
    ? `/me/tracks?offset=${offset}&limit=${limit}`
    : `/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`;
  const res = await spotifyFetch(endpoint, {});
  const data = await res.json();
  return {
    tracks: data.items.map(item => mapTrack(playlistId === LIKED_SONGS_PLAYLIST_ID ? item.track : item.track)),
    total: data.total,
  };
}
```

---

## 7. Expo Router — Auth Flow File Structure

```
app/
  _layout.tsx              ← root layout, checks auth state
  (auth)/
    _layout.tsx
    login.tsx              ← Spotify OAuth trigger
  (app)/
    _layout.tsx            ← protected: redirects to /login if not authed
    index.tsx              ← playlist source picker (home screen)
    destination.tsx        ← destination playlist picker
    swipe/
      [playlistId].tsx     ← swipe screen (Phase 2)
    matches.tsx            ← matches (Phase 3)
```

**Root layout auth guard:**
```tsx
// app/_layout.tsx
import { useAuthStore } from '@/stores/authStore';
import { Redirect, Slot } from 'expo-router';

export default function RootLayout() {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  return <Slot />;
}
```

**Protected layout redirect:**
```tsx
// app/(app)/_layout.tsx
export default function AppLayout() {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Redirect href="/login" />;
  return <Slot />;
}
```

---

## 8. ESLint No-Cross-Adapter Rule

**Option A: Custom ESLint rule (recommended for strictness)**
```js
// eslint-rules/no-spotify-outside-adapters.js
module.exports = {
  meta: { type: 'error' },
  create(context) {
    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        const file = context.getFilename();
        if (
          src.includes('adapters/spotify') &&
          !file.includes('src/adapters/')
        ) {
          context.report({ node, message: 'Do not import from adapters/spotify outside src/adapters/' });
        }
      }
    };
  }
};
```
Add to `.eslintrc.js`:
```js
plugins: ['./eslint-rules'],
rules: { './eslint-rules/no-spotify-outside-adapters': 'error' }
```

**Option B: TypeScript path alias (simpler but less strict)**
In `tsconfig.json` + `babel.config.js`, mark `src/adapters/spotify` as a private module. Less enforcement than ESLint — prefer Option A.

---

## 9. Backend — Express + PostgreSQL Schema

### PostgreSQL Schema (all tables needed through Phase 3)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id UUID UNIQUE NOT NULL,    -- Supabase Auth user ID
  spotify_user_id TEXT UNIQUE NOT NULL,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_id TEXT NOT NULL,
  owner_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  cover_art_url TEXT,
  track_count INT,
  cached_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (spotify_playlist_id)
);

CREATE TABLE tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_track_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,          -- primary artist
  album TEXT,
  album_art_url TEXT,
  duration_ms INT,
  preview_url TEXT
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  source_playlist_id TEXT NOT NULL,    -- Spotify playlist ID
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  swiped_count INT DEFAULT 0,
  liked_count INT DEFAULT 0,
  super_liked_count INT DEFAULT 0
);

CREATE TABLE swipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  spotify_track_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('liked', 'super_liked', 'skipped', 'pending')),
  swiped_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE swipe_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swipe_id UUID REFERENCES swipes(id) ON DELETE CASCADE NOT NULL,
  spotify_playlist_id TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_swipes_session ON swipes(session_id);
CREATE INDEX idx_swipes_user_status ON swipes(user_id, status);
CREATE INDEX idx_swipes_pending ON swipes(user_id, spotify_track_id) WHERE status = 'pending';
CREATE INDEX idx_swipe_destinations_swipe ON swipe_destinations(swipe_id);
```

**Notes:**
- `swipe_destinations` covers REQ-005 (multi-destination writes per swipe)
- `sessions` table covers REQ-004 (session-level track tracking for end screen + mosaic)
- `status` enum covers REQ-002 (`pending`, `super_liked`, `liked`, `skipped`)
- `LIKED_SONGS_SENTINEL` stored as `spotify:collection:tracks` in `source_playlist_id` — fine as TEXT

### Express Server Structure
```
backend/
  src/
    index.ts           ← app entry, middleware setup, route mounting
    middleware/
      auth.ts          ← requireAuth (Supabase JWT verification)
    routes/
      auth.ts          ← POST /auth/register, POST /auth/refresh
      users.ts         ← GET /users/me
      swipes.ts        ← POST /swipes, GET /swipes (Phase 2)
      sessions.ts      ← POST /sessions, PATCH /sessions/:id
      matches.ts       ← GET /matches (Phase 3)
    db/
      client.ts        ← Supabase client (service role for DB ops)
      schema.sql       ← source of truth for schema
```

### Express Middleware Stack
```ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();
app.use(helmet());
app.use(cors({ origin: ['http://localhost:3000'] })); // expand for production
app.use(express.json({ limit: '1mb' }));
```

---

## 10. Playlist Picker — Source Picker Implementation Details

### Section List Structure
```ts
// Two sections: owned (alphabetical) then followed (alphabetical)
// Liked Songs always first in owned section
const sections = [
  {
    title: 'My Playlists',
    data: [likedSongs, ...ownedPlaylists.sort(byName)],
  },
  {
    title: 'Following',
    data: followedPlaylists.sort(byName),
  },
];
```
Use React Native `SectionList` component for this layout.

### URL / Playlist ID Paste Field (D-06)
Input field that accepts:
- `https://open.spotify.com/playlist/{id}` — extract ID with regex
- `spotify:playlist:{id}` — extract ID after last `:`
- Raw playlist ID (22-char base62)

Validation: `GET /playlists/{id}` — if 404/403, show "Playlist not found or private". If `requiresExplicitFollow` capability is true and it's not in the user's library, show `PlaylistAccessGuard` follow-first flow.

---

## 11. Playlist Picker — Destination Picker Implementation Details

### Multi-Select Checkbox List
```tsx
// State
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

// Toggle handler
const handleToggle = (playlistId: string) => {
  setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(playlistId) ? next.delete(playlistId) : next.add(playlistId);
    return next;
  });
};
```

Show only **owned** playlists (user can write to). Filter: `isOwned === true`.
Bottom sticky "Confirm" button enabled when `selectedIds.size > 0`.

### "+ New Playlist" inline creation (D-09)
```tsx
// Show "New Playlist" row at top when no owned playlists
// Tap opens an Alert.prompt (iOS) or custom modal (Android)
// On confirm: call adapter.createPlaylist(name)
// Newly created playlist is pre-selected (add ID to selectedIds)
```

---

## 12. Security Considerations (ASVS Level 1)

- **D-11 enforced**: Backend never receives or stores Spotify tokens
- **Supabase JWT verification** on every authenticated endpoint (no bypass possible)
- **SecureStore** for all tokens — never AsyncStorage, never memory-only
- **PKCE** (not implicit flow) — no client_secret in mobile app
- **SQL injection**: use parameterized queries throughout backend (no string concatenation in SQL)
- **CORS**: restrict to known origins in production
- **Helmet**: HTTP security headers on Express
- **Scopes minimum viable**: only request OAuth scopes needed through Phase 5 — listed in Section 1 above
- **Lint enforcement**: ESLint rule prevents accidental Spotify token exposure outside adapter layer

---

## 13. Validation Architecture

The following test cases are required to verify Phase 1 completion:

### Auth Tests
- [ ] PKCE flow completes successfully and tokens are stored in SecureStore
- [ ] Silent token refresh occurs when `expiresAt - 5min` threshold is crossed
- [ ] 401 reactive fallback: new token fetched, request retried once
- [ ] Double 401: silent logout, auth state cleared, user routed to login
- [ ] App launch with valid tokens: user is authenticated without re-login
- [ ] App launch with no tokens: user is routed to login screen

### Adapter Interface Tests
- [ ] `getUserPlaylists()` returns Liked Songs as first item in owned section
- [ ] `getPlaylistTracks(LIKED_SONGS_PLAYLIST_ID)` calls `GET /me/tracks` (not `GET /playlists/...`)
- [ ] `getPlaylistTracks(realPlaylistId)` calls `GET /playlists/{id}/tracks`
- [ ] `addToPlaylist()` calls correct Spotify endpoint
- [ ] `saveToLibrary()` calls `PUT /me/tracks` (REQ-001)
- [ ] `createPlaylist()` calls `POST /users/{id}/playlists` and returns new ID (REQ-003)
- [ ] All `PlatformError` codes mapped from HTTP status codes

### Architectural Boundary Tests
- [ ] ESLint rule fires when any file outside `src/adapters/` imports from `src/adapters/spotify/`
- [ ] No TypeScript errors in adapter interface file

### Backend Tests
- [ ] `POST /auth/register` creates user record and returns Supabase JWT
- [ ] `GET /users/me` with valid JWT returns user data
- [ ] `GET /users/me` without JWT returns 401
- [ ] PostgreSQL schema migrates cleanly (all tables + indexes created)

### UI/Integration Tests
- [ ] Source picker shows two sections: "My Playlists" (Liked Songs first) and "Following"
- [ ] Source picker empty state shows Liked Songs + nudge text
- [ ] URL paste resolves to playlist and navigates to destination picker
- [ ] Destination picker allows multi-select and Confirm button activates
- [ ] Destination empty state shows "+ New Playlist" option
- [ ] Creating new playlist inline: pre-selected in destination list

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Expo Go redirect URI mismatch | Configure `useProxy: true` for Expo Go, custom scheme for builds — register both in Spotify dashboard |
| Supabase + Spotify dual-auth complexity | Keep it simple: Supabase is identity layer only; backend calls `supabase.auth.getUser()` per request |
| `SecureStore` unavailable in some Expo Go scenarios | Add graceful null check on token read; treat null as logged-out state |
| Spotify rate limits on `/me/playlists` pagination | Use max limit=50, cache playlist list in Zustand, avoid refetching on every mount |
| PKCE code_verifier/challenge mismatch | Use Expo's built-in PKCE — don't implement manually |

---

*Phase: 01-auth-interface-design-skeleton*
*Research completed: 2026-05-15*
