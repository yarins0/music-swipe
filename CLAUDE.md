# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MusicSwipe — a React Native (Expo) app where users swipe through music playlist tracks Tinder-style while they play live. Liked tracks are saved to destination playlists. A Node.js/Express backend handles auth proxying, swipe sync, and matches storage.

## Commands

### Mobile (Expo)
```bash
npx expo start              # start dev server (scan QR or press i/a)
npx expo run:ios            # build and launch on iOS simulator
npx expo run:android        # build and launch on Android emulator
npx expo lint               # lint via ESLint
npx jest                    # run all tests
npx jest --testPathPattern="SwipeEngine"  # run a single test file by name
```

### Backend
```bash
npm run dev     # start Express server with hot reload (nodemon)
npm test        # run backend tests
npm run lint    # lint backend code
```

### EAS (production builds)
```bash
eas build --platform ios
eas build --platform android
```

## Architecture

### Adapter Layer (the central constraint)
The entire codebase outside `src/adapters/` must be platform-agnostic. **No Spotify-specific strings, types, or imports are permitted in any UI or business logic file.** All platform integrations implement `MusicPlatformAdapter`:

```
src/adapters/
  interface.ts          ← MusicPlatformAdapter interface + PlatformError enum + capability flags
  spotify/
    SpotifyAdapter.ts   ← sole Spotify implementation
    spotifyFetch.ts     ← internal helper: token refresh + maps HTTP errors → PlatformError
  mock/
    MockAdapter.ts      ← full fixture-based implementation for testing (Phase 4+)
```

`spotifyFetch()` is the only place that talks to the Spotify Web API. It handles silent token refresh and maps all API error codes to the generic `PlatformError` enum (`NO_ACTIVE_DEVICE`, `PREMIUM_REQUIRED`, `RATE_LIMITED`, `AUTH_EXPIRED`, etc.). Never call Spotify endpoints directly from business logic.

### Key Components
| Component | Location | Role |
|---|---|---|
| `AuthGateway` | `src/auth/` | OAuth PKCE, token storage/refresh, per-platform |
| `PlaylistAccessGuard` | `src/components/` | Reads `requiresExplicitFollow` capability flag; shows follow-first UI if needed |
| `SwipeEngine` | `src/swipe/` | Card stack state, gesture handling, like/skip events, optimistic local state via Zustand |
| `TrackPlayer` | `src/player/` | Play/pause/seek via adapter — never calls Spotify directly |
| `SegmentNavigator` | `src/player/` | Tap-left/right → seek ±20s; interface designed to be upgraded to AI-segment detection in v2 |
| `PlaylistResolver` | `src/playlist/` | Fetches + paginates tracks; normalises to internal `Track` type |
| `PlaylistWriter` | `src/playlist/` | Adds/removes tracks via adapter; calls are queued + retried, **never block the swipe UI** |
| `MatchesStore` | `src/matches/` | Server-fetched liked tracks; always treat the server as source of truth for matches |
| `PlatformDeepLink` | `src/deeplink/` | Interface for launching the platform's native app; Phase 1 is a no-op stub |
| Backend API | `backend/` | Express: OAuth token proxy, users, swipe sync, matches CRUD |

### Data flow invariants
- **Swipe events**: recorded to local Zustand state immediately, then fire-and-forget sync to backend. Local state wins on conflict. Never await the sync call in the swipe handler.
- **Matches**: always fetched from the server. The local optimistic cache is stale-while-revalidate only.
- **Playlist writes** (likes landing in destination): queued, retried with exponential backoff on `RATE_LIMITED`. Never block the card stack.
- **Active device check**: on session start → if `NO_ACTIVE_DEVICE`, show "Open your music app" prompt + trigger `PlatformDeepLink`.

### State
- Local swipe + session state: **Zustand** stores persisted via AsyncStorage.
- Navigation: **Expo Router** (file-based, typed routes).

### Backend schema (PostgreSQL via Supabase)
Tables: `users`, `playlists`, `tracks`, `matches`. Backend is a single Express monolith — no microservices.

## Architectural Rules

1. **Adapter boundary**: If a file outside `src/adapters/` imports anything from `src/adapters/spotify/`, it is a bug.
2. **PlatformError only**: All adapter implementations must map their platform-specific errors to `PlatformError` before they leave the adapter. UI code only handles `PlatformError` values.
3. **Capability flags over conditionals**: Use adapter capability flags (`requiresExplicitFollow`, `supportsSeek`, `requiresPremium`) in UI logic — never check `if platform === 'spotify'`.
4. **SegmentNavigator interface**: Keep the seek abstraction behind `SegmentNavigator`; the interface exists to support a future AI-segment upgrade without changing callers.
5. **MockAdapter must stay complete**: `MockAdapter` must implement every method of `MusicPlatformAdapter`. Any new adapter method needs a mock implementation before the PR merges.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
