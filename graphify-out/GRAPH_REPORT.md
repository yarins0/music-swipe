# Graph Report - music-swipe  (2026-06-14)

## Corpus Check
- 132 files · ~84,223 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1199 nodes · 1810 edges · 68 communities (59 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1bb0e4b9`
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
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 70|Community 70]]

## God Nodes (most connected - your core abstractions)
1. `useTheme()` - 40 edges
2. `PlaylistWriter` - 39 edges
3. `SpotifyAdapter` - 30 edges
4. `MockAdapter` - 28 edges
5. `useSwipeStore` - 23 edges
6. `Findings` - 23 edges
7. `colors` - 22 edges
8. `Track` - 22 edges
9. `useAuthStore` - 21 edges
10. `spotifyFetch()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `StatCard()` --calls--> `useTheme()`  [EXTRACTED]
  app/(tabs)/session-end.tsx → src/hooks/useTheme.ts
- `LikedTrackRow()` --calls--> `useTheme()`  [EXTRACTED]
  app/(tabs)/session-end.tsx → src/hooks/useTheme.ts
- `RootLayout()` --calls--> `useAuthStore`  [EXTRACTED]
  app/_layout.tsx → src/stores/authStore.ts
- `AuthLayout()` --calls--> `useAuthStore`  [EXTRACTED]
  app/(auth)/_layout.tsx → src/stores/authStore.ts
- `DestinationPickerScreen()` --calls--> `useSessionStore`  [EXTRACTED]
  app/(tabs)/destination.tsx → src/stores/sessionStore.ts

## Communities (68 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.17
Nodes (11): Playlist, extractSpotifyPlaylistId(), getUserPlaylists(), PlaylistSections, resolvePlaylistFromUrl(), id, likedSongs, mockAdapter (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (30): dependencies, cors, dotenv, express, express-rate-limit, helmet, @supabase/supabase-js, devDependencies (+22 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (27): backgroundColor, foregroundImage, adaptiveIcon, package, typedRoutes, expo, android, experiments (+19 more)

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
Cohesion: 0.05
Nodes (39): DECIDED_STATUSES, decidedTrackIds, destIds, destinationsBySwipe, destRows, existingId, existingMap, filters (+31 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (24): A1 · Persisted prefs store + wire settings.tsx, A2 · Remove Spotify Sync toggle, A3 · Dynamic version + GitHub releases link, A4 · Privacy Policy and Terms of Service screens, A5 · Contact Me screen, Agent A — Settings / Prefs, Agent B — Swipe Card UI & Gesture, Agent C — Preview Player (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (30): PendingWrite, StorageInterface, adapter, { adapter, storage, writer }, { adapter, writer }, buildMockStorage(), session1, session2 (+22 more)

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (9): createRateLimiter(), globalRateLimiter, normaliseIp(), parsePositiveInt(), RateLimiterOptions, resolveClientKey(), app, app (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (14): BackendSwipeItem, fetchFromBackend(), MatchRecord, UseMatchesStoreResult, calledInit, calledUrl, DEST_IDS, ids (+6 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (28): app, authenticateAs(), decidedMock, deleteDestMock, deleteMock, destInsert1Mock, destMock, existingMock (+20 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (3): chunkArray(), SpotifyAdapter, spotifyBasicAuth()

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (20): BackendSync, SwipePayload, body, enqueueFailedPostSwipe(), fetchMock, fetchMock2, flushFetch, flushMock (+12 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (28): after, before, DEST_IDS, entry, existingSwipe, fullState, ids, meta() (+20 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (18): Adapter capabilities, Adding a New Platform, Architecture, code:block1 (requiresExplicitFollow   — whether the user must follow a pl), Data Flow Invariants, Decide Later tracks, Gesture and button mapping, Key Decisions (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (20): Adapter Layer (the central constraint), Architectural Rules, Architecture, Backend, Backend schema (PostgreSQL via Supabase), code:bash (npx expo start              # start dev server (scan QR or p), code:bash (npm run dev     # start Express server with hot reload (node), code:bash (eas build --platform ios) (+12 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (17): MusicPlatformAdapter, PlatformError, PlatformErrorCode, Track, UserProfile, DEFAULT_PLAYLISTS, DEFAULT_TRACKS, MockCalls (+9 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (11): detectSwipeDirection(), SNAP_BACK_CONFIG, UseSwipeGestureOptions, UseSwipeGestureResult, capturedHandlers, onSwipe, panBuilder, { resetCard } (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (18): mapSpotifyTrack(), SpotifyAlbum, SpotifyArtist, SpotifyImage, SpotifyPlaylistItem, SpotifyPlaylistOwner, SpotifyTrackItem, SpotifyTrackObject (+10 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (29): code:ts (const handleSeekBack = useCallback(async (): Promise<void> =), code:ts (for (let attempt = entry.attempts; attempt < MAX_ATTEMPTS; a), code:ts (// Fetch all tracks — paginate if needed (simple single-page), code:ts (async saveToLibrary(trackId: string): Promise<void> {), code:ts (// useSpotifyAuth.ts), Fixes applied (2026-05-31), Fixes applied (2026-06-04), H1 — Both segment-seek handlers are broken (+21 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir, resolveJsonModule, rootDir (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (15): Backend Schema (updated), Build-Time Unknowns, Context, Decisions Made, Design Exploration Artifacts, Implementation Phases, Out of Scope (for now), Phase 1 — Auth, Interface Design & Skeleton (Foundation) (+7 more)

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (7): BottomNavBar(), NavTabProps, resolveActiveIndex(), styles, TAB_ITEMS, TabItem, getMostRecentResumableSession()

### Community 27 - "Community 27"
Cohesion: 0.15
Nodes (9): createSpotifyAdapter(), createSpotifyAuthContext(), LikedTrackRow(), LikedTrackRowProps, SessionStats, StatCard(), statStyles, styles (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.23
Nodes (9): clientOptions, supabase, supabaseAuth, requireAuth(), mockFrom, next, req, res (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (12): skills, supabase, supabase-postgres-best-practices, computedHash, computedHash, skillPath, source, sourceType (+4 more)

### Community 30 - "Community 30"
Cohesion: 0.17
Nodes (5): addCall, bodies, deleteCall, localItem, mockSpotifyFetch

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (19): usePrefsStore, SessionActions, SessionState, useSessionStore, styles, SwipeCard(), SwipeCardProps, computeSeekStepMs() (+11 more)

### Community 32 - "Community 32"
Cohesion: 0.17
Nodes (12): devDependencies, @babel/core, babel-plugin-module-resolver, eslint-config-expo, eslint-plugin-rulesdir, husky, jest, jest-expo (+4 more)

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (34): LoginScreen(), styles, useSpotifyAuth(), AppModal(), AppModalProps, styles, PlaylistRow(), PlaylistRowProps (+26 more)

### Community 34 - "Community 34"
Cohesion: 0.20
Nodes (9): compilerOptions, ignoreDeprecations, paths, strict, types, exclude, extends, include (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.07
Nodes (28): ☑ C1 — Decide-later restore reads the wrong response field (CRITICAL), ☑ C2 — Cancelled pan gesture never springs back; card can freeze (HIGH; was flagged Critical), code:bash (npx jest                 # mobile unit/sequence tests), Findings, ☑ H1 — Spotify token-refresh concurrent burst → forced logout (HIGH), ☑ H2 — `onAuthExpired` fires on any non-OK refresh → transient outage = permanent logout (HIGH), ☑ H3 — PlaylistWriter durable-queue read-modify-write race → lost crash-recovery entries (HIGH), ☑ H4 — Backend API has no rate limiting except `/auth/register` (HIGH) (+20 more)

### Community 36 - "Community 36"
Cohesion: 0.10
Nodes (14): app, destChain, endedAt, mockFrom, mockInsertChain, mockSelectChain, mockSessionChain, mockSwipesChain (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (5): password, registerLimiter, router, { spotifyAccessToken }, SpotifyUser

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (13): useMatchesStore(), useActiveSession(), useSwipeStore, useHistoryHydration(), dividerStyles, ListItem, MatchesScreen(), SessionHeader (+5 more)

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (5): compat, { FlatCompat }, noSpotifyOutsideAdapters, rule, { RuleTester }

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (9): SessionMeta, SessionPatch, SessionTracker, SessionStatus, body, fetchMock, [, init], result (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (4): assertion, auth, mockFetch, promise

### Community 43 - "Community 43"
Cohesion: 0.08
Nodes (18): styles, TabHeader(), TabHeaderProps, LinkRowProps, pickerStyles, SectionProps, SettingRowProps, styles (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.06
Nodes (27): RootLayout(), styles, AuthLayout(), discovery, SCOPES, UseSpotifyAuthReturn, ErrorBoundary, ErrorBoundaryProps (+19 more)

### Community 45 - "Community 45"
Cohesion: 0.07
Nodes (28): counts, countsBySession, CreateSessionBody, destIdsError, destinationsBySwipe, destNamesError, {
    endedAt,
    resumeOffset,
    status,
    sourcePlaylistName,
    destinationPlaylistIds,
    destinationPlaylistNames,
    totalTracks,
    isFilterMode,
  }, { endedAt, swipedCount, likedCount, superLikedCount } (+20 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (10): ActiveSessionPatch, CreateSessionMeta, INITIAL_STATE, LIVE_RESET, migrateSwipeStore(), PersistedSwipeState, SwipeActions, SwipeRecord (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.20
Nodes (10): scripts, android, build, graph, graph:watch, ios, lint, prepare (+2 more)

### Community 48 - "Community 48"
Cohesion: 0.40
Nodes (3): AdapterCapabilities, PlaylistAccessGuardProps, styles

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (6): main, name, overrides, tar, @xmldom/xmldom, version

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (6): jest, moduleNameMapper, preset, setupFiles, transformIgnorePatterns, ^@react-native-async-storage/async-storage$

### Community 57 - "Community 57"
Cohesion: 0.13
Nodes (16): formatDate(), LikedRowProps, SessionCard(), SessionCardProps, StylesType, isResumable(), SessionEntry, SwipeRecord (+8 more)

### Community 58 - "Community 58"
Cohesion: 0.33
Nodes (4): DestinationEditor(), DestinationEditorProps, Scope, styles

### Community 59 - "Community 59"
Cohesion: 0.15
Nodes (5): fetchMock, notWritten, { sessions }, store, written

### Community 60 - "Community 60"
Cohesion: 0.29
Nodes (4): AudioPlayer, AudioStatus, expoAudio, PreviewPlayerControls

### Community 61 - "Community 61"
Cohesion: 0.24
Nodes (10): mapPendingSwipesToTracks(), PendingSwipeResponse, restoredSwipeToTrack(), RestoredTrackMetadata, BACKEND_TRACK, fallbackUri(), result, sparse (+2 more)

### Community 62 - "Community 62"
Cohesion: 0.50
Nodes (4): buildTracksById(), toTrackResponse(), TrackResponse, TrackRow

### Community 63 - "Community 63"
Cohesion: 0.50
Nodes (3): SegmentNavigator(), SegmentNavigatorProps, styles

### Community 64 - "Community 64"
Cohesion: 0.14
Nodes (8): openPlatformDeepLink(), TrackPlayer, usePreviewPlayer(), InitPhase, phaseLabel(), styles, SwipeScreen(), mockOpenURL

### Community 67 - "Community 67"
Cohesion: 0.16
Nodes (9): mapHttpError(), performTokenRefresh(), refreshSpotifyToken(), sleep(), SpotifyAuthContext, apiCall, auth, FakeResponseOptions (+1 more)

## Knowledge Gaps
- **647 isolated node(s):** `name`, `slug`, `version`, `scheme`, `orientation` (+642 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MockAdapter` connect `Community 10` to `Community 9`, `Community 19`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `PlaylistWriter` connect `Community 24` to `Community 64`, `Community 38`, `Community 9`, `Community 44`, `Community 19`, `Community 27`, `Community 31`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `Track` connect `Community 19` to `Community 64`, `Community 9`, `Community 59`, `Community 12`, `Community 46`, `Community 15`, `Community 16`, `Community 21`, `Community 57`, `Community 27`, `Community 61`, `Community 31`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _647 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.14210526315789473 - nodes in this community are weakly interconnected._