# Graph Report - music-swipe  (2026-05-27)

## Corpus Check
- 94 files · ~52,245 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 845 nodes · 1215 edges · 54 communities (48 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e2623caf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]

## God Nodes (most connected - your core abstractions)
1. `SpotifyAdapter` - 26 edges
2. `MockAdapter` - 23 edges
3. `PlaylistWriter` - 22 edges
4. `colors` - 19 edges
5. `useAuthStore` - 19 edges
6. `MusicPlatformAdapter` - 16 edges
7. `spotifyFetch()` - 16 edges
8. `SpotifyAdapter` - 16 edges
9. `useSwipeStore` - 16 edges
10. `expo` - 15 edges

## Surprising Connections (you probably didn't know these)
- `RootLayout()` --calls--> `useAuthStore`  [EXTRACTED]
  app/_layout.tsx → src/stores/authStore.ts
- `AuthLayout()` --calls--> `useAuthStore`  [EXTRACTED]
  app/(auth)/_layout.tsx → src/stores/authStore.ts
- `DestinationPickerScreen()` --calls--> `useSessionStore`  [EXTRACTED]
  app/(tabs)/destination.tsx → src/stores/sessionStore.ts
- `SourcePickerScreen()` --calls--> `useAuthStore`  [EXTRACTED]
  app/(tabs)/index.tsx → src/stores/authStore.ts
- `MatchesScreen()` --calls--> `useSwipeStore`  [EXTRACTED]
  app/(tabs)/matches.tsx → src/stores/swipeStore.ts

## Communities (54 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (43): createSpotifyAdapter(), createSpotifyAuthContext(), LoginScreen(), styles, discovery, SCOPES, useSpotifyAuth(), UseSpotifyAuthReturn (+35 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (30): dependencies, cors, dotenv, express, express-rate-limit, helmet, @supabase/supabase-js, devDependencies (+22 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (27): backgroundColor, foregroundImage, adaptiveIcon, package, typedRoutes, expo, android, experiments (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (6): mapSpotifyPlaylist(), SpotifyAdapter, mapHttpError(), refreshSpotifyToken(), sleep(), spotifyFetch()

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (25): 1. Clone and install, 2. Configure environment variables, 3. Initialize the database, 4. Run, Adapter capabilities, Architecture, Backend (`backend/.env`), code:bash (git clone <repo>) (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (24): buildType, node, build, base, development, preview, production, cli (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (25): dependencies, expo, expo-audio, expo-auth-session, expo-checkbox, expo-constants, expo-crypto, expo-font (+17 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (24): destIds, destinationsBySwipe, destRows, existingId, existingMap, filters, insertedRows, insertRows (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (24): A1 · Persisted prefs store + wire settings.tsx, A2 · Remove Spotify Sync toggle, A3 · Dynamic version + GitHub releases link, A4 · Privacy Policy and Terms of Service screens, A5 · Contact Me screen, Agent A — Settings / Prefs, Agent B — Swipe Card UI & Gesture, Agent C — Preview Player (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (19): PendingWrite, StorageInterface, adapter, addToPlaylist, authError, callOrder, drainPromise, entry (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (18): mapSpotifyTrack(), SpotifyAlbum, SpotifyArtist, SpotifyImage, SpotifyPlaylistItem, SpotifyPlaylistOwner, SpotifyTrackItem, SpotifyTrackObject (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (16): BackendSwipeItem, fetchFromBackend(), MatchRecord, useMatchesStore(), UseMatchesStoreResult, MatchesScreen(), calledInit, calledUrl (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (16): app, authenticateAs(), deleteDestMock, destInsert1Mock, destMock, existingMock, insertDestMock, insertMock (+8 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (3): chunkArray(), SpotifyAdapter, spotifyBasicAuth()

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (11): BackendSync, SwipePayload, body, fetchMock, fetchMock2, [, init], p1, p2 (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.10
Nodes (18): after, before, DEST_IDS, existingSwipe, fullState, options, { pendingSyncSwipes }, persisted (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (18): Adapter capabilities, Adding a New Platform, Architecture, code:block1 (requiresExplicitFollow   — whether the user must follow a pl), Data Flow Invariants, Decide Later tracks, Gesture and button mapping, Key Decisions (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (17): Adapter Layer (the central constraint), Architectural Rules, Architecture, Backend, Backend schema (PostgreSQL via Supabase), code:bash (npx expo start              # start dev server (scan QR or p), code:bash (npm run dev     # start Express server with hot reload (node), code:bash (eas build --platform ios) (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (12): AdapterCapabilities, MusicPlatformAdapter, Track, UserProfile, PlaylistAccessGuardProps, styles, DEFAULT_PLAYLISTS, DEFAULT_TRACKS (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (10): RootLayout(), styles, ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState, styles, button, errorLogCall (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (14): AuthLayout(), AuthActions, AuthState, KEYS, calledKeys, mockDeleteItem, mockSetItem, SECURE_STORE_KEYS (+6 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (9): openPlatformDeepLink(), SessionTracker, DestinationEditor(), DestinationEditorProps, Scope, styles, styles, SwipeEngineProps (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir, resolveJsonModule, rootDir (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (15): Backend Schema (updated), Build-Time Unknowns, Context, Decisions Made, Design Exploration Artifacts, Implementation Phases, Out of Scope (for now), Phase 1 — Auth, Interface Design & Skeleton (Foundation) (+7 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (12): BottomNavBar(), NavTabProps, resolveActiveIndex(), styles, TAB_ITEMS, TabItem, INITIAL_STATE, SwipeActions (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.15
Nodes (10): SessionActions, SessionState, useSessionStore, DestinationPickerScreen(), LikedTrackRowProps, SessionEndScreen(), SessionStats, statStyles (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.23
Nodes (9): clientOptions, supabase, supabaseAuth, requireAuth(), mockFrom, next, req, res (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (12): skills, supabase, supabase-postgres-best-practices, computedHash, computedHash, skillPath, source, sourceType (+4 more)

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (10): detectSwipeDirection(), SwipeDirection, useSwipeGesture(), UseSwipeGestureOptions, UseSwipeGestureResult, onSwipe, panBuilder, { resetCard } (+2 more)

### Community 31 - "Community 31"
Cohesion: 0.24
Nodes (10): usePreviewPlayer(), SettingsScreen(), PrefsActions, PrefsState, usePrefsStore, InitPhase, phaseLabel(), styles (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (11): devDependencies, @babel/core, babel-plugin-module-resolver, eslint-config-expo, eslint-plugin-rulesdir, jest, jest-expo, @testing-library/react-native (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.24
Nodes (7): Playlist, extractSpotifyPlaylistId(), PlaylistSections, resolvePlaylistFromUrl(), id, likedSongs, mockAdapter

### Community 34 - "Community 34"
Cohesion: 0.20
Nodes (9): compilerOptions, ignoreDeprecations, paths, strict, types, exclude, extends, include (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.27
Nodes (5): PlatformError, PlatformErrorCode, SpotifyAuthContext, err, mockSpotifyFetch

### Community 36 - "Community 36"
Cohesion: 0.20
Nodes (6): app, endedAt, mockFrom, mockInsertChain, mockSelectChain, mockUpdateChain

### Community 37 - "Community 37"
Cohesion: 0.20
Nodes (6): password, registerLimiter, router, { spotifyAccessToken }, SpotifyUser, app

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (9): scripts, android, build, graph, graph:watch, ios, lint, start (+1 more)

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (5): compat, { FlatCompat }, noSpotifyOutsideAdapters, rule, { RuleTester }

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (6): SegmentNavigator(), SegmentNavigatorProps, styles, styles, SwipeCard(), SwipeCardProps

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (5): body, fetchMock, [, init], result, [url, init]

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (4): AudioPlayer, AudioStatus, expoAudio, PreviewPlayerControls

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (6): main, name, overrides, tar, @xmldom/xmldom, version

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (4): assertion, auth, mockFetch, promise

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (6): CreateSessionBody, { endedAt, swipedCount, likedCount, superLikedCount }, router, { sourcePlaylistId }, updatePayload, UpdateSessionBody

### Community 48 - "Community 48"
Cohesion: 0.40
Nodes (5): jest, moduleNameMapper, preset, transformIgnorePatterns, ^@react-native-async-storage/async-storage$

## Knowledge Gaps
- **464 isolated node(s):** `name`, `slug`, `version`, `scheme`, `orientation` (+459 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MockAdapter` connect `Community 10` to `Community 19`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `SpotifyAdapter` connect `Community 3` to `Community 0`, `Community 35`, `Community 11`, `Community 46`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `PlaylistWriter` connect `Community 24` to `Community 0`, `Community 9`, `Community 22`, `Community 27`, `Community 31`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _464 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.052313883299798795 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._