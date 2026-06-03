# MusicSwipe

Swipe through a Spotify playlist Tinder-style while tracks play live. Liked and super-liked tracks are saved to one or more destination playlists. Built with React Native (Expo) and an Express/Supabase backend.

---

## ⚠️ Spotify Development Mode Limitation

MusicSwipe uses the Spotify Web API. While the app is in **development mode** (not yet approved for Extended Quota), only manually allowlisted users can log in.

**To add a tester:**
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → your app → **Settings** → **User Management**
2. Add the user's Spotify email address
3. Limit: **5 users** in development mode (Spotify's quota)

Additionally, the Spotify API **only returns playlists owned by the authenticated user** (or those they follow). Playlists owned by other users cannot be accessed as a source or destination unless the authenticated user follows them. This is a Spotify platform constraint, not a bug.

---

## Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/): `npm install -g expo`
- [EAS CLI](https://docs.expo.dev/eas/) (for production builds): `npm install -g eas-cli`
- A Spotify Developer account with an app created at [developer.spotify.com](https://developer.spotify.com/dashboard)
- A Supabase project (free tier works) — schema in `backend/src/db/schema.sql`

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo>
cd music-swipe
npm install
cd backend && npm install && cd ..
```

### 2. Configure environment variables

**Mobile** — copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Set `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` to your Spotify app's client ID, and `EXPO_PUBLIC_BACKEND_URL` to wherever your backend runs.

**Backend** — copy `backend/.env.example` to `backend/.env`:

```bash
cp backend/.env.example backend/.env
```

Fill in your Supabase project URL and keys, and your Spotify client ID and secret.

### 3. Initialize the database

```bash
psql "$DATABASE_URL" -f backend/src/db/schema.sql
```

### 4. Run

Start the backend:

```bash
cd backend && npm run dev
```

Start the mobile dev server (in a separate terminal):

```bash
npx expo start
```

Scan the QR code with Expo Go, or press `i` for iOS simulator / `a` for Android emulator.

---

## Architecture

MusicSwipe is built around a platform adapter boundary. All Spotify-specific code lives inside `src/adapters/spotify/`. Everything else — UI, swipe logic, playlist management — talks only to the `MusicPlatformAdapter` interface.

### Key modules

| Module | Role |
|---|---|
| `src/adapters/` | Platform adapter interface, Spotify implementation, and a fixture-based mock for tests |
| `src/auth/` | OAuth PKCE login flow and token lifecycle via `expo-auth-session` |
| `src/swipe/` | Card stack, gesture handling, like/skip/super-like events (Zustand state) |
| `src/player/` | Track playback and ±20s seek via the adapter; preview URL fallback via `expo-audio` |
| `src/playlist/` | Playlist fetching and pagination |
| `src/services/` | `PlaylistWriter` (queued track writes), `BackendSync` (swipe sync), `SessionTracker` |
| `src/deeplink/` | Opens the Spotify native app when no active device is found |
| `backend/` | Express API: OAuth proxy, swipe sync, session tracking, matches storage (Supabase) |

### Data flow

- **Swipe events** are written to local Zustand state immediately, then synced to the backend fire-and-forget. Local state wins on conflict.
- **Playlist writes** (liked tracks landing in destination playlists) are queued and retried with exponential backoff. They never block the swipe UI.
- **No active device**: if Spotify has no active playback device at session start, MusicSwipe triggers a deep link to open Spotify and shows an alert. The swipe session is preserved.
- **Decide Later** tracks are held in-session and get a second pass. Unresolved tracks persist to the backend as `pending` and resurface in the next session.

### Adapter capabilities

The adapter exposes a capability flags object (`AdapterCapabilities`) that UI components read to adjust their behaviour — for example, whether explicit playlist follow is required before writing. No UI code checks `if platform === 'spotify'`; it checks the flags.

---

## Tests

```bash
# Run all tests
npx jest

# Run a specific test file
npx jest --testPathPattern="SwipeEngine"

# Type-check
npm run build
```

The test suite uses a `MockAdapter` — a full fixture-based implementation of `MusicPlatformAdapter` — so no Spotify credentials are needed to run tests.

---

## Production Builds

```bash
eas build --platform ios
eas build --platform android
```

Build profiles are in `eas.json`. The `preview` profile builds a standalone APK/IPA for internal distribution; `production` targets the App Store and Play Store.

---

## Environment Variables Reference

### Mobile (`.env.local`)

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` | Spotify app client ID from the developer dashboard |
| `EXPO_PUBLIC_BACKEND_URL` | URL of the running Express backend |

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (full DB access — keep secret) |
| `SUPABASE_ANON_KEY` | Anon/public key |
| `DATABASE_URL` | Direct Postgres connection string (for running migrations) |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `PORT` | Port for the Express server (default: 3000) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
