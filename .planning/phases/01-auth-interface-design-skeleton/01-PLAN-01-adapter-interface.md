---
id: 01-PLAN-01
title: Adapter Interface & ESLint Boundary
wave: 1
depends_on: []
files_modified:
  - src/adapters/interface.ts
  - src/adapters/index.ts
  - eslint-rules/no-spotify-outside-adapters.js
  - .eslintrc.js
  - tsconfig.json
autonomous: true
requirements_addressed:
  - REQ-001
  - REQ-003
  - REQ-005
---

# Plan 01: Adapter Interface & ESLint Boundary

## Objective

Define the `MusicPlatformAdapter` interface, `PlatformError` enum, all shared types (`Track`, `Playlist`, `AdapterCapabilities`), and the Liked Songs sentinel constant. Configure the ESLint rule that prevents any file outside `src/adapters/` from importing `src/adapters/spotify/`.

This plan has no runtime behavior — it is the architectural contract that every other plan depends on. It must be complete before any adapter implementation or UI work begins.

## Tasks

<task id="T01-01">
<title>Create src/adapters/interface.ts</title>

<read_first>
- CLAUDE.md (adapter boundary rules, TypeScript standards)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-01 through D-12, capability flags, Liked Songs sentinel ID)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 5 — complete interface)
- .planning/REQUIREMENTS.md (REQ-001 saveToLibrary, REQ-003 createPlaylist, REQ-005 multi-destination)
- .planning/notes/button-bar-gesture-design.md (which adapter methods Phase 2 needs)
- .planning/notes/decide-later-session-persistence.md (pending status)
- .planning/notes/end-of-session-screen.md (createPlaylist use case)
</read_first>

<action>
Create src/adapters/interface.ts with:

1. `PlatformErrorCode` enum — values: NO_ACTIVE_DEVICE, PREMIUM_REQUIRED, RATE_LIMITED, AUTH_EXPIRED, NOT_FOUND, PERMISSION_DENIED, PLAYLIST_NOT_FOUND, NETWORK_ERROR, UNKNOWN
2. `PlatformError` class extending Error — constructor(code: PlatformErrorCode, message?: string), sets this.name = 'PlatformError', exposes readonly `code` field
3. `Track` interface — fields: id, uri, title, artist, artists (string[]), album, albumArtUrl, durationMs, previewUrl (string | null)
4. `Playlist` interface — fields: id, name, coverArtUrl (string | null), trackCount, isOwned, isFollowed
5. `AdapterCapabilities` interface — fields: requiresExplicitFollow, supportsSeek, requiresPremium, supportsLibrarySave, supportsPlaylistCreation — all boolean
6. `MusicPlatformAdapter` interface with these method signatures:
   - readonly capabilities: AdapterCapabilities
   - isAuthenticated(): Promise<boolean>
   - refreshAuth(): Promise<void>
   - getUserId(): Promise<string>
   - getUserPlaylists(): Promise<Playlist[]>
   - getPlaylistById(playlistId: string): Promise<Playlist>
   - getPlaylistTracks(playlistId: string, offset?: number, limit?: number): Promise<{ tracks: Track[]; total: number }>
   - play(trackUri: string): Promise<void>
   - pause(): Promise<void>
   - seek(positionMs: number): Promise<void>
   - getCurrentTrack(): Promise<Track | null>
   - getCurrentPositionMs(): Promise<number>
   - addToPlaylist(playlistId: string, trackId: string): Promise<void>
   - removeFromPlaylist(playlistId: string, trackId: string): Promise<void>
   - saveToLibrary(trackId: string): Promise<void>
   - createPlaylist(name: string): Promise<string>
   - openPlatformDeepLink(uri: string): Promise<void>
7. `LIKED_SONGS_PLAYLIST_ID = 'spotify:collection:tracks'` exported constant

All types exported. No implementation code in this file.
</action>

<acceptance_criteria>
- src/adapters/interface.ts exists and TypeScript compiles without errors (`npx tsc --noEmit`)
- File exports: PlatformErrorCode, PlatformError, Track, Playlist, AdapterCapabilities, MusicPlatformAdapter, LIKED_SONGS_PLAYLIST_ID
- PlatformError class has `code` property accessible: `new PlatformError(PlatformErrorCode.AUTH_EXPIRED).code === 'AUTH_EXPIRED'`
- MusicPlatformAdapter includes saveToLibrary and createPlaylist methods (REQ-001, REQ-003)
- LIKED_SONGS_PLAYLIST_ID = 'spotify:collection:tracks'
</acceptance_criteria>
</task>

<task id="T01-02">
<title>Create src/adapters/index.ts (barrel export)</title>

<read_first>
- src/adapters/interface.ts (just created in T01-01)
</read_first>

<action>
Create src/adapters/index.ts that re-exports everything from interface.ts:
- export * from './interface'

Do not export from spotify/ subdirectory — that would violate the boundary rule.
</action>

<acceptance_criteria>
- src/adapters/index.ts exists
- `import { MusicPlatformAdapter } from '@/adapters'` resolves without errors
- No exports from ./spotify in this barrel
</acceptance_criteria>
</task>

<task id="T01-03">
<title>Create ESLint rule: no-spotify-outside-adapters</title>

<read_first>
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 8 — ESLint rule)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-12, architectural rule #1 and #5)
- CLAUDE.md (architectural rules)
</read_first>

<action>
1. Create directory `eslint-rules/` in project root.
2. Create `eslint-rules/no-spotify-outside-adapters.js`:
   - ESLint rule that reports an error when an ImportDeclaration's source value includes 'adapters/spotify' and the current filename does not include 'src/adapters/'
   - Error message: "Importing from src/adapters/spotify/ is not allowed outside src/adapters/ — use the MusicPlatformAdapter interface instead"
   - meta.type = 'error', meta.docs.description = 'Prevents direct Spotify adapter imports outside the adapter boundary'

3. Update .eslintrc.js (or create it if missing):
   - Add plugin reference to ./eslint-rules
   - Add rule: 'local/no-spotify-outside-adapters': 'error'
   - Ensure the rule runs on .ts and .tsx files
</action>

<acceptance_criteria>
- eslint-rules/no-spotify-outside-adapters.js exists
- Running `npx expo lint` reports an error if a test file outside src/adapters/ contains `import { SpotifyAdapter } from '../adapters/spotify/SpotifyAdapter'`
- Running `npx expo lint` reports no error for a file inside src/adapters/ importing from ./spotify/
- .eslintrc.js references the rule
</acceptance_criteria>
</task>

<task id="T01-04">
<title>Configure TypeScript path aliases</title>

<read_first>
- tsconfig.json (current contents)
- app.json or app.config.ts (check if babel-plugin-module-resolver is in use)
</read_first>

<action>
In tsconfig.json, add compilerOptions.paths:
- "@/*": ["./src/*"] — so imports like @/adapters, @/stores, @/components resolve to src/

If babel.config.js or babel.config.ts exists, add module-resolver plugin with the same alias.

Do not add the @/adapters/spotify alias — only the root @/ alias. Intentionally omitting the spotify alias makes it harder to import accidentally.
</action>

<acceptance_criteria>
- `import { MusicPlatformAdapter } from '@/adapters'` compiles without path errors
- tsconfig.json contains paths: { "@/*": ["./src/*"] }
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

## Verification

<verification>
### Goal-Backward Check
Phase 1 success criterion 4: "MusicPlatformAdapter interface is fully typed with all methods including saveToLibrary() and createPlaylist()"
Phase 1 success criterion 5: "No file outside src/adapters/ imports from src/adapters/spotify/"

This plan directly delivers criteria 4 and 5 before any implementation begins.

### Verification Commands
```bash
npx tsc --noEmit
npx expo lint
```

Both must exit 0 after this plan completes.
</verification>

<must_haves>
truths:
  - src/adapters/interface.ts exists and defines MusicPlatformAdapter with saveToLibrary() and createPlaylist()
  - LIKED_SONGS_PLAYLIST_ID = 'spotify:collection:tracks' is exported from src/adapters/interface.ts
  - ESLint rule fires on cross-boundary imports
  - TypeScript path alias @/* resolves to src/*
</must_haves>
