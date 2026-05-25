# Graph Report - .  (2026-05-25)

## Corpus Check
- Corpus is ~38,476 words - fits in a single context window. You may not need a graph.

## Summary
- 872 nodes · 1154 edges · 81 communities (52 shown, 29 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Spotify Mapper & DTO Layer|Spotify Mapper & DTO Layer]]
- [[_COMMUNITY_App Screens & Navigation|App Screens & Navigation]]
- [[_COMMUNITY_Architecture Patterns & Docs|Architecture Patterns & Docs]]
- [[_COMMUNITY_Swipe Core & Services|Swipe Core & Services]]
- [[_COMMUNITY_Backend Dependencies|Backend Dependencies]]
- [[_COMMUNITY_PlaylistWriter Queue|PlaylistWriter Queue]]
- [[_COMMUNITY_Platform Adapter Interface|Platform Adapter Interface]]
- [[_COMMUNITY_App Configuration|App Configuration]]
- [[_COMMUNITY_Swipe DB Routes|Swipe DB Routes]]
- [[_COMMUNITY_EAS Build Config|EAS Build Config]]
- [[_COMMUNITY_Playlist Screen Types|Playlist Screen Types]]
- [[_COMMUNITY_Frontend Dependencies|Frontend Dependencies]]
- [[_COMMUNITY_Backend Test Infrastructure|Backend Test Infrastructure]]
- [[_COMMUNITY_SpotifyAdapter CRUD|SpotifyAdapter CRUD]]
- [[_COMMUNITY_BackendSync Service|BackendSync Service]]
- [[_COMMUNITY_Adapter Layer Core|Adapter Layer Core]]
- [[_COMMUNITY_SwipeStore Tests|SwipeStore Tests]]
- [[_COMMUNITY_Express Backend Core|Express Backend Core]]
- [[_COMMUNITY_MockAdapter Implementation|MockAdapter Implementation]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Adapter Capabilities|Adapter Capabilities]]
- [[_COMMUNITY_PlatformError System|PlatformError System]]
- [[_COMMUNITY_TrackPlayer|TrackPlayer]]
- [[_COMMUNITY_ErrorBoundary|ErrorBoundary]]
- [[_COMMUNITY_Matches Store Tests|Matches Store Tests]]
- [[_COMMUNITY_Backend DB Client|Backend DB Client]]
- [[_COMMUNITY_SessionTracker|SessionTracker]]
- [[_COMMUNITY_Supabase Skills Config|Supabase Skills Config]]
- [[_COMMUNITY_Swipe Gesture|Swipe Gesture]]
- [[_COMMUNITY_Matches Screen|Matches Screen]]
- [[_COMMUNITY_Sessions Route Tests|Sessions Route Tests]]
- [[_COMMUNITY_Dev Dependencies|Dev Dependencies]]
- [[_COMMUNITY_Backend Auth Routes|Backend Auth Routes]]
- [[_COMMUNITY_TS Paths Config|TS Paths Config]]
- [[_COMMUNITY_Adapter Contract Tests|Adapter Contract Tests]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_MusicPlatformAdapter|MusicPlatformAdapter]]
- [[_COMMUNITY_SwipeStore State|SwipeStore State]]
- [[_COMMUNITY_SegmentNavigator|SegmentNavigator]]
- [[_COMMUNITY_Sessions Route|Sessions Route]]
- [[_COMMUNITY_App Build Config|App Build Config]]
- [[_COMMUNITY_Build Scripts|Build Scripts]]
- [[_COMMUNITY_Jest Config|Jest Config]]
- [[_COMMUNITY_Adapter Boundary Rules|Adapter Boundary Rules]]
- [[_COMMUNITY_Android App Icons|Android App Icons]]
- [[_COMMUNITY_Matches Store|Matches Store]]
- [[_COMMUNITY_Web Assets|Web Assets]]
- [[_COMMUNITY_App Icon Assets|App Icon Assets]]
- [[_COMMUNITY_PlatformDeepLink|PlatformDeepLink]]
- [[_COMMUNITY_Splash Screen|Splash Screen]]
- [[_COMMUNITY_Playlist URL Resolver|Playlist URL Resolver]]
- [[_COMMUNITY_Playlist Sections|Playlist Sections]]
- [[_COMMUNITY_App & EAS Config|App & EAS Config]]
- [[_COMMUNITY_ErrorBoundary Component|ErrorBoundary Component]]
- [[_COMMUNITY_ESLint Adapter Rule|ESLint Adapter Rule]]
- [[_COMMUNITY_SpotifyAdapter Batch Writes|SpotifyAdapter Batch Writes]]
- [[_COMMUNITY_Express Types|Express Types]]
- [[_COMMUNITY_Build Config|Build Config]]
- [[_COMMUNITY_Project Overview|Project Overview]]
- [[_COMMUNITY_Expo Router|Expo Router]]
- [[_COMMUNITY_Database Schema|Database Schema]]
- [[_COMMUNITY_Frontend Packages|Frontend Packages]]
- [[_COMMUNITY_Backend Packages|Backend Packages]]
- [[_COMMUNITY_Backend TS Config|Backend TS Config]]
- [[_COMMUNITY_ESLint Base Config|ESLint Base Config]]
- [[_COMMUNITY_Supabase Skills|Supabase Skills]]
- [[_COMMUNITY_Backend Jest Config|Backend Jest Config]]
- [[_COMMUNITY_Tracks Table|Tracks Table]]
- [[_COMMUNITY_PlaylistRow|PlaylistRow]]
- [[_COMMUNITY_PlatformError Tests|PlatformError Tests]]
- [[_COMMUNITY_Mappers Tests|Mappers Tests]]
- [[_COMMUNITY_spotifyFetch Tests|spotifyFetch Tests]]
- [[_COMMUNITY_Playback Tests|Playback Tests]]
- [[_COMMUNITY_BackendSync Class|BackendSync Class]]
- [[_COMMUNITY_SwipePayload|SwipePayload]]
- [[_COMMUNITY_PlaylistWriter Class|PlaylistWriter Class]]
- [[_COMMUNITY_SessionTracker Class|SessionTracker Class]]
- [[_COMMUNITY_Session Close Logic|Session Close Logic]]

## God Nodes (most connected - your core abstractions)
1. `SpotifyAdapter` - 22 edges
2. `MockAdapter` - 19 edges
3. `useAuthStore` - 17 edges
4. `SpotifyAdapter` - 16 edges
5. `expo` - 15 edges
6. `spotifyFetch()` - 15 edges
7. `PlatformErrorCode` - 14 edges
8. `Swipe Screen (app/(app)/swipe/[playlistId].tsx)` - 14 edges
9. `PlatformError` - 13 edges
10. `Track` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Adaptive Icon` --conceptually_related_to--> `MusicSwipe App`  [INFERRED]
  assets/adaptive-icon.png → app.json
- `Adapter Boundary Rule` --semantically_similar_to--> `Adapter Boundary Constraint`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/ARCHITECTURE.md
- `Frontend TypeScript Config` --semantically_similar_to--> `Babel Config with Module Resolver`  [INFERRED] [semantically similar]
  tsconfig.json → babel.config.js
- `Adaptive Icon` --references--> `Android Adaptive Icon Config`  [EXTRACTED]
  assets/adaptive-icon.png → app.json
- `RootLayout()` --calls--> `useAuthStore`  [EXTRACTED]
  app/_layout.tsx → src/stores/authStore.ts

## Hyperedges (group relationships)
- **Adapter Contract Enforcement Triad** — claudemd_music_platform_adapter, arch_eslint_rule, claudemd_mock_adapter [EXTRACTED 0.95]
- **Swipe UI Responsiveness Pattern** — plan_local_first_swipe, claudemd_playlist_writer, arch_fire_and_forget_sync [INFERRED 0.85]
- **Session Data Flow** — plan_session_tracker, plan_sessions_table, plan_swipes_table [EXTRACTED 0.95]
- **End-to-End Swipe Session Flow** — sourcepickerscreen_sourcepickerscreen, destinationpickerscreen_destinationpickerscreen, swipescreen_swipescreen, sessionendscreen_sessionendscreen [INFERRED 0.95]
- **Auth Guard Pattern (Root + App + Auth layouts)** — rootlayout_rootlayout, applayout_applayout, authlayout_authlayout, authstore_authstore [EXTRACTED 1.00]
- **SwipeScreen Service Orchestration** — swipescreen_swipescreen, trackplayer_trackplayer, playlistwriter_playlistwriter, sessiontracker_sessiontracker, backendsync_backendsync [EXTRACTED 1.00]
- **Adapter Pattern: Interface + SpotifyAdapter + MockAdapter** — adapters_interface_MusicPlatformAdapter, adapters_spotify_SpotifyAdapter, adapters_mock_MockAdapter [EXTRACTED 1.00]
- **Backend Route + Auth Middleware + DB Client Pattern** — backend_middleware_requireAuth, backend_db_supabaseClient, backend_routes_sessionsRouter, backend_routes_swipesRouter, backend_routes_usersRouter [EXTRACTED 1.00]
- **Spotify HTTP Error → PlatformErrorCode Mapping Chain** — adapters_spotify_spotifyFetch, adapters_spotify_spotifyFetch_mapHttpError, adapters_interface_PlatformErrorCode, adapters_interface_PlatformError [EXTRACTED 1.00]
- **Adapter Correctness Test Suite** — adaptercontract_test, spotifyadapter_crud_test, spotifyadapter_playback_test, spotifyfetch_test, mappers_test [EXTRACTED 1.00]
- **Auth Flow Components (PKCE to AuthContext to SpotifyAdapter)** — usespotifyauth_hook, authgateway_createspotifyauthcontext, authgateway_createspotifyadapter, authgateway_spotifyauthcontext [EXTRACTED 0.95]
- **Seek Capability Path (SegmentNavigator to TrackPlayer to supportsSeek)** — segmentnavigator_component, trackplayer_seekto, adaptercontract_capabilityflags [INFERRED 0.85]
- **Swipe Core UX Loop: Gesture to Optimistic State to Fire-and-Forget Sync** — SwipeEngine_handleSwipe, swipeStore_recordSwipe, BackendSync_postSwipe, PlaylistWriter_write, SessionTracker_incrementCounts, useSwipeGesture_runOnJSBridge [EXTRACTED 1.00]
- **Zustand Store Trio: authStore + sessionStore + swipeStore Form the App State Layer** — authStore_useAuthStore, sessionStore_useSessionStore, swipeStore_useSwipeStore [INFERRED 0.85]
- **Durable Write Queue: PlaylistWriter persists to AsyncStorage before network, retries on RATE_LIMITED, drains on next launch** — PlaylistWriter_write, PlaylistWriter_executeWithBackoff, PlaylistWriter_AsyncStorageQueue, PlaylistWriter_drainStoredQueue [EXTRACTED 1.00]

## Communities (81 total, 29 thin omitted)

### Community 0 - "Spotify Mapper & DTO Layer"
Cohesion: 0.05
Nodes (23): mapSpotifyPlaylist(), mapSpotifyTrack(), SpotifyAlbum, SpotifyArtist, SpotifyImage, SpotifyPlaylistItem, SpotifyPlaylistOwner, SpotifyTrackItem (+15 more)

### Community 1 - "App Screens & Navigation"
Cohesion: 0.05
Nodes (36): DestinationPickerScreen(), AppLayout(), RootLayout(), styles, SessionEndScreen(), SessionStats, styles, AuthLayout() (+28 more)

### Community 2 - "Architecture Patterns & Docs"
Cohesion: 0.05
Nodes (44): New Platform Onboarding Guide, Exponential Backoff on RATE_LIMITED, Fire-and-Forget Sync Pattern, Playlist Write Queue (AsyncStorage), Spotify Premium Requirement, SegmentNavigator Interface Abstraction, Session Lifecycle Management, AsyncStorage (+36 more)

### Community 3 - "Swipe Core & Services"
Cohesion: 0.07
Nodes (34): BackendSync.flushPending Batch Flush Method, BackendSync.postSwipe Fire-and-Forget Method, ButtonBar Component, DestinationEditor Component, DestinationEditor Three-Scope Edit Pattern, AsyncStorage Durable Write Queue Pattern, PlaylistWriter.drainStoredQueue Static Method, PlaylistWriter.executeWithBackoff Retry with Exponential Backoff (+26 more)

### Community 4 - "Backend Dependencies"
Cohesion: 0.06
Nodes (30): dependencies, cors, dotenv, express, express-rate-limit, helmet, @supabase/supabase-js, devDependencies (+22 more)

### Community 5 - "PlaylistWriter Queue"
Cohesion: 0.07
Nodes (20): PendingWrite, PlaylistWriter, StorageInterface, adapter, addToPlaylist, authError, callOrder, drainPromise (+12 more)

### Community 6 - "Platform Adapter Interface"
Cohesion: 0.10
Nodes (31): PlatformError / PlatformErrorCode Enum, App Group Layout (app/(app)/_layout.tsx), AuthGateway createSpotifyAdapter, createSpotifyAuthContext, SpotifyAuthContext (token callbacks), Auth Group Layout (app/(auth)/_layout.tsx), Auth Store (Zustand), BackendSync Service (+23 more)

### Community 7 - "App Configuration"
Cohesion: 0.07
Nodes (27): backgroundColor, foregroundImage, adaptiveIcon, package, typedRoutes, expo, android, experiments (+19 more)

### Community 8 - "Swipe DB Routes"
Cohesion: 0.08
Nodes (24): destIds, destinationsBySwipe, destRows, existingId, existingMap, filters, insertedRows, insertRows (+16 more)

### Community 9 - "EAS Build Config"
Cohesion: 0.09
Nodes (24): buildType, node, build, base, development, preview, production, cli (+16 more)

### Community 10 - "Playlist Screen Types"
Cohesion: 0.14
Nodes (16): Playlist, styles, Section, styles, createSpotifyAdapter(), createSpotifyAuthContext(), PlaylistRow(), PlaylistRowProps (+8 more)

### Community 11 - "Frontend Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, expo, expo-audio, expo-auth-session, expo-checkbox, expo-constants, expo-crypto, expo-image (+14 more)

### Community 12 - "Backend Test Infrastructure"
Cohesion: 0.10
Nodes (17): app, authenticateAs(), deleteDestMock, destInsert1Mock, destMock, existingMock, insertDestMock, insertMock (+9 more)

### Community 13 - "SpotifyAdapter CRUD"
Cohesion: 0.12
Nodes (3): chunkArray(), SpotifyAdapter, spotifyBasicAuth()

### Community 14 - "BackendSync Service"
Cohesion: 0.12
Nodes (11): BackendSync, SwipePayload, body, fetchMock, fetchMock2, [, init], p1, p2 (+3 more)

### Community 15 - "Adapter Layer Core"
Cohesion: 0.19
Nodes (19): Adapters Public Barrel Export, AdapterCapabilities Interface, MusicPlatformAdapter Interface, PlatformError Class, PlatformErrorCode Enum, Playlist Interface, Track Interface, MockAdapter (Fixture-Based Test Implementation) (+11 more)

### Community 16 - "SwipeStore Tests"
Cohesion: 0.11
Nodes (17): after, before, DEST_IDS, fullState, options, { pendingSyncSwipes }, persisted, { queue } (+9 more)

### Community 17 - "Express Backend Core"
Cohesion: 0.24
Nodes (18): Supabase DB Client Singleton, Express Application Entry Point, requireAuth Middleware, Auth Router (POST /auth/register), deriveUserPassword (HKDF-SHA256), getSpotifyUser (Spotify /me proxy), Sessions Router (POST/GET/PATCH /sessions), Swipes Router (POST/GET /swipes) (+10 more)

### Community 19 - "TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir, resolveJsonModule, rootDir (+8 more)

### Community 20 - "Adapter Capabilities"
Cohesion: 0.18
Nodes (10): AdapterCapabilities, Track, PlaylistAccessGuardProps, styles, DEFAULT_PLAYLISTS, DEFAULT_TRACKS, MockCalls, MockFixtures (+2 more)

### Community 21 - "PlatformError System"
Cohesion: 0.17
Nodes (11): PlatformError, PlatformErrorCode, SpotifyDevice, SpotifyDevicesResponse, SpotifyMeResponse, SpotifyNewPlaylistResponse, SpotifyPaginatedResponse, SpotifyPlayerState (+3 more)

### Community 22 - "TrackPlayer"
Cohesion: 0.13
Nodes (10): TrackPlayer, ButtonBar(), ButtonBarProps, styles, DestinationEditor(), DestinationEditorProps, Scope, styles (+2 more)

### Community 23 - "ErrorBoundary"
Cohesion: 0.14
Nodes (8): ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState, styles, button, errorLogCall, { getByText }, { queryByText }

### Community 24 - "Matches Store Tests"
Cohesion: 0.14
Nodes (10): calledInit, calledUrl, DEST_IDS, ids, mockResponse, multiDest, { result }, TRACK_A (+2 more)

### Community 25 - "Backend DB Client"
Cohesion: 0.23
Nodes (8): supabase, requireAuth(), mockFrom, mockGetUser, next, req, res, router

### Community 26 - "SessionTracker"
Cohesion: 0.15
Nodes (6): SessionTracker, body, fetchMock, [, init], result, [url, init]

### Community 27 - "Supabase Skills Config"
Cohesion: 0.15
Nodes (12): skills, supabase, supabase-postgres-best-practices, computedHash, computedHash, skillPath, source, sourceType (+4 more)

### Community 28 - "Swipe Gesture"
Cohesion: 0.18
Nodes (10): detectSwipeDirection(), SwipeDirection, useSwipeGesture(), UseSwipeGestureOptions, UseSwipeGestureResult, onSwipe, panBuilder, { resetCard } (+2 more)

### Community 29 - "Matches Screen"
Cohesion: 0.23
Nodes (8): MatchesScreen(), styles, TrackRowProps, BackendSwipeItem, fetchFromBackend(), MatchRecord, useMatchesStore(), UseMatchesStoreResult

### Community 30 - "Sessions Route Tests"
Cohesion: 0.18
Nodes (7): app, endedAt, mockFrom, mockGetUser, mockInsertChain, mockSelectChain, mockUpdateChain

### Community 31 - "Dev Dependencies"
Cohesion: 0.18
Nodes (11): devDependencies, @babel/core, babel-plugin-module-resolver, eslint-config-expo, eslint-plugin-rulesdir, jest, jest-expo, @testing-library/react-native (+3 more)

### Community 32 - "Backend Auth Routes"
Cohesion: 0.20
Nodes (6): password, registerLimiter, router, { spotifyAccessToken }, SpotifyUser, app

### Community 33 - "TS Paths Config"
Cohesion: 0.20
Nodes (9): compilerOptions, ignoreDeprecations, paths, strict, types, exclude, extends, include (+1 more)

### Community 34 - "Adapter Contract Tests"
Cohesion: 0.22
Nodes (10): AdapterCapabilities Contract Verification, Adapter Contract Tests (MockAdapter), PlaylistAccessGuard Component, requiresExplicitFollow Capability Flag Gate, SegmentNavigator Component, SegmentNavigator Thin Seek Interface (AI-upgrade boundary), SpotifyAdapter CRUD Tests, TrackPlayer Class (+2 more)

### Community 35 - "ESLint Config"
Cohesion: 0.22
Nodes (5): compat, { FlatCompat }, noSpotifyOutsideAdapters, rule, { RuleTester }

### Community 36 - "MusicPlatformAdapter"
Cohesion: 0.31
Nodes (5): MusicPlatformAdapter, openPlatformDeepLink(), InitPhase, styles, mockOpenURL

### Community 37 - "SwipeStore State"
Cohesion: 0.25
Nodes (7): INITIAL_STATE, SwipeActions, SwipeRecord, SwipeState, SwipeStatus, useSwipeStore, SwipeEngine()

### Community 38 - "SegmentNavigator"
Cohesion: 0.29
Nodes (6): SegmentNavigator(), SegmentNavigatorProps, styles, styles, SwipeCard(), SwipeCardProps

### Community 39 - "Sessions Route"
Cohesion: 0.29
Nodes (6): CreateSessionBody, { endedAt, swipedCount, likedCount, superLikedCount }, router, { sourcePlaylistId }, updatePayload, UpdateSessionBody

### Community 40 - "App Build Config"
Cohesion: 0.29
Nodes (6): main, name, overrides, tar, @xmldom/xmldom, version

### Community 41 - "Build Scripts"
Cohesion: 0.29
Nodes (7): scripts, android, build, ios, lint, start, test

### Community 42 - "Jest Config"
Cohesion: 0.40
Nodes (5): jest, moduleNameMapper, preset, transformIgnorePatterns, ^@react-native-async-storage/async-storage$

### Community 43 - "Adapter Boundary Rules"
Cohesion: 0.50
Nodes (5): Adapter Boundary Constraint, ESLint Rule no-spotify-outside-adapters, Adapter Boundary Rule, Adapter Layer, YAGNI Platform Agnosticism

### Community 44 - "Android App Icons"
Cohesion: 0.67
Nodes (4): Adaptive Icon, Android Adaptive Icon Config, Android Platform, MusicSwipe App

### Community 45 - "Matches Store"
Cohesion: 0.50
Nodes (4): SessionMosaicGrid Component, fetchFromBackend Fallback Function, useMatchesStore Hook, useMatchesStore Tests

### Community 46 - "Web Assets"
Cohesion: 0.67
Nodes (3): MusicSwipe Favicon, MusicSwipe App Web Target, Web Browser Icon

### Community 47 - "App Icon Assets"
Cohesion: 0.67
Nodes (3): MusicSwipe App Icon, Expo React Native Application, MusicSwipe Brand Identity

### Community 48 - "PlatformDeepLink"
Cohesion: 0.67
Nodes (3): PlatformDeepLink Module, PlatformDeepLink No-Op Stub (Phase 1), PlatformDeepLink Tests

### Community 49 - "Splash Screen"
Cohesion: 0.67
Nodes (3): App Branding, MusicSwipe App Launch, Splash Screen

## Knowledge Gaps
- **444 isolated node(s):** `name`, `slug`, `version`, `scheme`, `orientation` (+439 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuthStore` connect `App Screens & Navigation` to `Playlist Screen Types`, `MusicPlatformAdapter`, `Matches Screen`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `MockAdapter` connect `MockAdapter Implementation` to `Adapter Capabilities`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `SpotifyAdapter` connect `Spotify Mapper & DTO Layer` to `Playlist Screen Types`, `PlatformError System`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _456 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Spotify Mapper & DTO Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.05019607843137255 - nodes in this community are weakly interconnected._
- **Should `App Screens & Navigation` be split into smaller, more focused modules?**
  _Cohesion score 0.053877551020408164 - nodes in this community are weakly interconnected._
- **Should `Architecture Patterns & Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.05179704016913319 - nodes in this community are weakly interconnected._