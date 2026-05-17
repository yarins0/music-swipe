---
id: 01-PLAN-04
title: Auth Gateway & Expo Router Layout
wave: 2
depends_on:
  - 01-PLAN-01
  - 01-PLAN-02
files_modified:
  - src/auth/AuthGateway.ts
  - src/auth/useSpotifyAuth.ts
  - src/stores/authStore.ts
  - app/_layout.tsx
  - app/(auth)/_layout.tsx
  - app/(auth)/login.tsx
  - app/(app)/_layout.tsx
  - app.json
autonomous: true
requirements_addressed: []
---

# Plan 04: Auth Gateway & Expo Router Layout

## Objective

Implement the Spotify OAuth PKCE flow using Expo AuthSession, token persistence in SecureStore, Supabase Auth registration, and the Expo Router layouts that guard authenticated routes. By the end of this plan, a user can complete OAuth login and land on a blank placeholder home screen. The playlist pickers are built in Plan 05.

## Tasks

<task id="T04-01">
<title>Configure app.json for Spotify OAuth redirect URI</title>

<read_first>
- app.json (current contents)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 1 — redirect URI setup, Expo scheme)
</read_first>

<action>
In app.json (or app.config.ts if it exists), set:
- expo.scheme = "MusicSwipe"
- expo.ios.bundleIdentifier = "com.yourcompany.MusicSwipe" (placeholder — will be updated before store submission)
- expo.android.package = "com.yourcompany.MusicSwipe"

Add to expo.extra:
- spotifyClientId: process.env.SPOTIFY_CLIENT_ID (for runtime access via Constants.expoConfig.extra)

In app/.env or .env.local (gitignored):
- SPOTIFY_CLIENT_ID=your-spotify-client-id
- BACKEND_URL=http://localhost:3000

Note for developer: Register these redirect URIs in the Spotify Developer Dashboard:
- exp://localhost:19000 (Expo Go)
- MusicSwipe:// (production build)
</action>

<acceptance_criteria>
- app.json contains scheme: "MusicSwipe"
- app.json contains ios.bundleIdentifier and android.package
- .env.example contains SPOTIFY_CLIENT_ID and BACKEND_URL
- .gitignore includes .env.local or .env
</acceptance_criteria>
</task>

<task id="T04-02">
<title>Create src/stores/authStore.ts (Zustand)</title>

<read_first>
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 2 — SecureStore key naming, auth state init)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-01, D-02, D-03)
</read_first>

<action>
Create src/stores/authStore.ts using Zustand:

State shape:
- isAuthenticated: boolean
- isLoading: boolean (true during initial token check on app launch)
- accessToken: string | null
- refreshToken: string | null
- expiresAt: number | null
- supabaseToken: string | null
- userId: string | null (Supabase user ID)

SecureStore keys (use these exact strings):
- 'spotify_access_token'
- 'spotify_refresh_token'
- 'spotify_expires_at'
- 'supabase_token'
- 'supabase_user_id'

Actions:
- `initialize()`: async — reads all 5 keys from SecureStore, sets state. If any token is missing, sets isAuthenticated: false. If all present and expiresAt > Date.now(), sets isAuthenticated: true.
- `setTokens({ accessToken, refreshToken, expiresAt, supabaseToken, userId })`: writes all values to SecureStore and updates state, sets isAuthenticated: true
- `updateAccessToken(accessToken: string, expiresAt: number)`: writes only the access token and expiry to SecureStore and state (used by proactive/reactive refresh)
- `clearAuth()`: deletes all 5 SecureStore keys, resets state to unauthenticated

The store should call `initialize()` once during app startup (see T04-05 root layout).
</action>

<acceptance_criteria>
- src/stores/authStore.ts exists and exports useAuthStore
- authStore reads from SecureStore on initialize(), not AsyncStorage
- authStore has clearAuth() that deletes all SecureStore keys
- authStore has updateAccessToken() that updates only the access token (not refresh token)
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T04-03">
<title>Create src/auth/useSpotifyAuth.ts (PKCE hook)</title>

<read_first>
- src/stores/authStore.ts
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 1 — useAuthRequest flow, scopes, discovery object, token exchange)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-01, D-02)
</read_first>

<action>
Create src/auth/useSpotifyAuth.ts:

Exports hook `useSpotifyAuth()` returning { login: () => void, isLoading: boolean, error: string | null }.

Implementation:
1. Define discovery object: { authorizationEndpoint: 'https://accounts.spotify.com/authorize', tokenEndpoint: 'https://accounts.spotify.com/api/token' }
2. Define scopes array with all required scopes (see RESEARCH.md Section 1 — 11 scopes)
3. Determine redirectUri: use AuthSession.makeRedirectUri({ scheme: 'MusicSwipe' }) — also support useProxy in dev via __DEV__ check
4. Call AuthSession.useAuthRequest({ clientId: SPOTIFY_CLIENT_ID, scopes, usePKCE: true, redirectUri }, discovery)
5. useEffect: watch response — when response?.type === 'success':
   a. Exchange code for tokens: POST to discovery.tokenEndpoint with grant_type: authorization_code, code: response.params.code, redirect_uri: redirectUri, client_id: SPOTIFY_CLIENT_ID, code_verifier: request?.codeVerifier
   b. Compute expiresAt = Date.now() + tokenResponse.expires_in * 1000
   c. Call backend POST /auth/register with the Spotify access token → receive { supabaseToken, userId }
   d. Call authStore.setTokens({ accessToken, refreshToken, expiresAt, supabaseToken, userId })
6. Expose `login` function that calls promptAsync()
7. Handle errors: set error state on failed exchange or backend call
</action>

<acceptance_criteria>
- src/auth/useSpotifyAuth.ts exports useSpotifyAuth hook
- Hook calls AuthSession.useAuthRequest with usePKCE: true
- On successful response, hook calls POST /auth/register (not Spotify's token endpoint directly for user registration)
- On successful registration, authStore.setTokens is called with all 5 values
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T04-04">
<title>Create src/auth/AuthGateway.ts (spotifyFetch auth context bridge)</title>

<read_first>
- src/stores/authStore.ts
- src/adapters/spotify/spotifyFetch.ts (SpotifyAuthContext interface)
</read_first>

<action>
Create src/auth/AuthGateway.ts:

Export function `createSpotifyAuthContext(): SpotifyAuthContext` that:
- Reads current token values from authStore.getState()
- Provides onTokenRefreshed: async (newToken, newExpiresAt) => { authStore.getState().updateAccessToken(newToken, newExpiresAt) }
- Provides onAuthExpired: async () => { authStore.getState().clearAuth() }

This bridges the Zustand store to the spotifyFetch auth context interface.

Also export `createSpotifyAdapter(): SpotifyAdapter` that:
- Constructs and returns a SpotifyAdapter instance using the auth context from above
- This is the single factory function the rest of the app uses to get an adapter instance

Note: files outside src/adapters/ use `createSpotifyAdapter()` from this file — they never import SpotifyAdapter directly, preserving the boundary.
</action>

<acceptance_criteria>
- src/auth/AuthGateway.ts exports createSpotifyAdapter()
- createSpotifyAdapter() returns a MusicPlatformAdapter (typed as interface, not SpotifyAdapter class)
- ESLint passes (no direct import of SpotifyAdapter from outside adapters/)
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T04-05">
<title>Create Expo Router layouts (root, auth group, app group)</title>

<read_first>
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 7 — Expo Router file structure)
- src/stores/authStore.ts
</read_first>

<action>
Create the following layout files:

**app/_layout.tsx** (root):
- Import useAuthStore
- On mount: call authStore.initialize() in useEffect (once)
- While isLoading: return <ActivityIndicator /> centered on screen
- After loading: return <Slot />

**app/(auth)/_layout.tsx**:
- Simple: return <Slot />
- This group has no auth guard — it's where unauthenticated users land

**app/(auth)/login.tsx**:
- Import useSpotifyAuth
- Shows "Connect Spotify" button
- On press: calls login()
- Shows error message if error is set
- After auth completes, Expo Router automatically renders the (app) group because isAuthenticated is true

**app/(app)/_layout.tsx**:
- Import useAuthStore
- If !isAuthenticated: return <Redirect href="/(auth)/login" />
- Return <Slot />

**app/(app)/index.tsx** (placeholder — actual screen in Plan 05):
- Return a placeholder View with Text "Source Playlist Picker — coming in Plan 05"
</action>

<acceptance_criteria>
- app/_layout.tsx calls authStore.initialize() on mount
- app/(app)/_layout.tsx redirects to /(auth)/login when isAuthenticated is false
- app/(auth)/login.tsx renders without crashing and shows a login button
- `npx expo start` launches without errors
- Navigating to the app while not authenticated redirects to login screen
- After successful login, user is routed to app/(app)/index.tsx
</acceptance_criteria>
</task>

## Verification

<verification>
### Goal-Backward Check
Phase 1 success criterion 1: "User can complete Spotify OAuth PKCE flow and tokens are stored and refreshed silently"

This plan delivers the full PKCE login flow with SecureStore persistence and the silent refresh infrastructure.

### Manual Test
1. `npx expo start`, open on iOS/Android
2. Tap "Connect Spotify"
3. Complete OAuth in browser
4. Confirm you are redirected to the placeholder home screen
5. Kill app, reopen — confirm no re-login required (tokens persisted in SecureStore)

### Auth State Checks
- authStore.isAuthenticated is true after login
- authStore.accessToken and refreshToken are non-null after login
</verification>

<must_haves>
truths:
  - Tokens stored in SecureStore (not AsyncStorage)
  - OAuth uses PKCE (usePKCE: true in useAuthRequest)
  - Backend POST /auth/register called after Spotify PKCE completes — mobile never talks to Supabase Auth directly
  - clearAuth() deletes all SecureStore keys and resets Zustand state
  - AuthGateway.createSpotifyAdapter() is the only public factory for adapters — SpotifyAdapter never imported outside src/adapters/
</must_haves>
