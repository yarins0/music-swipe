---
id: 02-PLAN-04
title: SpotifyAdapter playback methods + TrackPlayer service + usePreviewPlayer + SegmentNavigator
wave: 2
depends_on:
  - 02-PLAN-01
files_modified:
  - src/adapters/spotify/SpotifyAdapter.ts
  - src/adapters/spotify/__tests__/SpotifyAdapter.playback.test.ts
  - src/player/TrackPlayer.ts
  - src/player/usePreviewPlayer.ts
  - src/player/SegmentNavigator.tsx
autonomous: true
requirements_addressed:
  - REQ-001
---

# Plan 04: Playback Layer

## Objective

Replace the Phase 1 playback stubs in `SpotifyAdapter` with real Spotify Connect implementations, then build the three player-layer abstractions on top: `TrackPlayer` (the service that SwipeEngine calls), `usePreviewPlayer` (expo-audio hook for the 30s preview fallback), and `SegmentNavigator` (the tap-zone component for ±20s seeking).

Purpose: Phase 2 UI (Plans 06 and 07) must call `TrackPlayer` — never the adapter directly. This plan establishes that layer.

Output: Fully implemented playback methods in `SpotifyAdapter.ts`, a test file covering all four playback methods, and three new files under `src/player/`.

## Interfaces

The `MusicPlatformAdapter` interface (adapter contract for playback):
```typescript
// From src/adapters/interface.ts
play(trackUri: string): Promise<void>;
pause(): Promise<void>;
seek(positionMs: number): Promise<void>;
getCurrentTrack(): Promise<Track | null>;
getCurrentPositionMs(): Promise<number>;
capabilities.supportsSeek: boolean        // true for SpotifyAdapter
capabilities.requiresPremium: boolean     // true for SpotifyAdapter
```

The `PlatformError` / `PlatformErrorCode` contract:
```typescript
// From src/adapters/interface.ts
PlatformErrorCode.NO_ACTIVE_DEVICE
PlatformErrorCode.PREMIUM_REQUIRED
PlatformErrorCode.RATE_LIMITED
```

## Tasks

<task id="T02-04-1">
<title>Task 1: Implement SpotifyAdapter playback methods (play, pause, seek, getCurrentPositionMs)</title>

<read_first>
- src/adapters/spotify/SpotifyAdapter.ts (MUST read entire file — play/pause/seek/getCurrentTrack/getCurrentPositionMs are stubs at lines 134-155; implement these without changing any other method)
- src/adapters/spotify/spotifyFetch.ts (the internal fetch helper — use this for all Spotify API calls; never use fetch() directly in SpotifyAdapter)
- src/adapters/interface.ts (PlatformError, PlatformErrorCode — import from here)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 2 — Spotify Connect implementation with device detection; Pitfall 1 — NO_ACTIVE_DEVICE; Open Question 2 — device caching recommendation)
</read_first>

<action>
Replace the four stub methods in SpotifyAdapter with real implementations. Do not touch any other method.

Add a private field to SpotifyAdapter: `private cachedDeviceId: string | null = null;`

Implement a private helper `getActiveDeviceId(): Promise<string>`:
- Call spotifyFetch('/me/player/devices', {}, this.auth) which returns `{ devices: Array<{ id: string; is_active: boolean }> }`
- Find device where is_active === true
- If found: cache in this.cachedDeviceId; return the id
- If not found: set this.cachedDeviceId = null; throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE)

Replace play(_trackUri):
1. Try this.cachedDeviceId first; if null, call getActiveDeviceId()
2. Call spotifyFetch(`/me/player/play?device_id=${deviceId}`, { method: 'PUT', body: JSON.stringify({ uris: [trackUri] }) }, this.auth)
3. On PlatformError(NO_ACTIVE_DEVICE): clear this.cachedDeviceId, re-throw

Replace pause():
- Call spotifyFetch('/me/player/pause', { method: 'PUT' }, this.auth)

Replace seek(positionMs):
- Call spotifyFetch(`/me/player/seek?position_ms=${positionMs}`, { method: 'PUT' }, this.auth)

Replace getCurrentPositionMs():
- Call spotifyFetch('/me/player', {}, this.auth) which returns `{ progress_ms: number | null }`
- Return data.progress_ms ?? 0

Leave getCurrentTrack() returning null — Phase 2 does not use it; Phase 5 can implement.

Required Spotify OAuth scopes (already requested in Phase 1 — no change needed):
- user-modify-playback-state (play, pause, seek)
- user-read-playback-state (getCurrentPositionMs, device list)
</action>

<acceptance_criteria>
- SpotifyAdapter.play(), .pause(), .seek(), .getCurrentPositionMs() no longer throw 'Playback not implemented in Phase 1'
- play() calls GET /me/player/devices before PUT /me/player/play (confirmed by reading the implementation)
- NO_ACTIVE_DEVICE is thrown when devices array has no active device
- cachedDeviceId is invalidated on NO_ACTIVE_DEVICE error
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T02-04-2">
<title>Task 2: TrackPlayer service + usePreviewPlayer hook + SegmentNavigator component</title>

<read_first>
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 3 — usePreviewPlayer hook with expo-audio; Pattern 2 — TrackPlayer decision tree; Pitfall 4 — null previewUrl handling; Architecture Diagram — TrackPlayer position in data flow)
- src/adapters/interface.ts (MusicPlatformAdapter interface — TrackPlayer receives the adapter, not SpotifyAdapter directly)
- CLAUDE.md (architectural rule: TrackPlayer calls adapter methods only — never Spotify endpoints)
</read_first>

<action>
Create src/player/TrackPlayer.ts (a plain TypeScript class, not a React component):

```
export class TrackPlayer {
  constructor(private readonly adapter: MusicPlatformAdapter) {}

  async play(track: Track): Promise<PlaybackResult>
  async pause(): Promise<void>
  async seekTo(positionMs: number): Promise<void>
  async getCurrentPositionMs(): Promise<number>
}
```

Where PlaybackResult is:
```typescript
export type PlaybackResult =
  | { strategy: 'connect' }       // Spotify Connect succeeded
  | { strategy: 'preview'; url: string }  // fell back to preview URL
  | { strategy: 'none'; reason: 'no_preview' | 'no_device' };  // nothing to play
```

play(track) logic:
1. If adapter.capabilities.requiresPremium is true: attempt adapter.play(track.uri)
   - On success → return { strategy: 'connect' }
   - On PlatformError(NO_ACTIVE_DEVICE) → fall through to preview
   - On PlatformError(PREMIUM_REQUIRED) → fall through to preview
2. Preview fallback: if track.previewUrl is non-null → return { strategy: 'preview', url: track.previewUrl }
3. No playback available → return { strategy: 'none', reason: track.previewUrl ? 'no_device' : 'no_preview' }

pause() calls adapter.pause() — swallows errors (user may not have active playback).

seekTo(positionMs) calls adapter.seek(positionMs) only if adapter.capabilities.supportsSeek is true; otherwise no-op.

---

Create src/player/usePreviewPlayer.ts following the pattern from RESEARCH.md Pattern 3 exactly:
- Accept previewUrl: string | null
- Use useAudioPlayer from 'expo-audio' with the url (or null)
- Return: { play, pause, seekTo, currentTime, duration, isPlaying, hasPreview }
- play() and pause() are no-ops when previewUrl is null

---

Create src/player/SegmentNavigator.tsx:
- A React component that renders two transparent tap zones stacked over the card: left half and right half
- Props: { onSeekBack: () => void; onSeekForward: () => void; disabled?: boolean }
- Left half tap → onSeekBack(); right half tap → onSeekForward()
- Uses Pressable (not TouchableOpacity — Pressable is the current standard)
- Each half fills 50% of the parent container width, full height
- disabled prop disables both Pressables
- No visual indicator (transparent zones) — taps are silent navigation

The caller (SwipeEngine) will pass seekBack={() => trackPlayer.seekTo(Math.max(0, currentPosition - 20000))} and seekForward. The exact position arithmetic lives in the caller, not SegmentNavigator.
</action>

<acceptance_criteria>
- src/player/TrackPlayer.ts exists; class TrackPlayer has play(track), pause(), seekTo(positionMs), getCurrentPositionMs() methods
- TrackPlayer.play() returns PlaybackResult with strategy: 'none' when both adapter throws NO_ACTIVE_DEVICE and track.previewUrl is null
- src/player/usePreviewPlayer.ts exists; exports usePreviewPlayer(previewUrl)
- src/player/SegmentNavigator.tsx exists; props interface requires onSeekBack and onSeekForward
- No import from 'src/adapters/spotify/' in any of the three files (ESLint rule enforces this)
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
</acceptance_criteria>
</task>

<task id="T02-04-3">
<title>Task 3: SpotifyAdapter playback unit tests</title>

<read_first>
- src/adapters/spotify/SpotifyAdapter.ts (the implementation written in Task 1 — read to understand method signatures before writing tests)
- src/adapters/spotify/spotifyFetch.ts (exported name to mock — jest.mock this module)
- src/adapters/interface.ts (PlatformErrorCode values to assert against)
</read_first>

<action>
Create src/adapters/spotify/__tests__/SpotifyAdapter.playback.test.ts.

Use jest.mock('../spotifyFetch') at the top of the file to mock the spotifyFetch module. Import the mocked version with `import { spotifyFetch } from '../spotifyFetch'` and cast to `jest.MockedFunction<typeof spotifyFetch>` for typed mock control.

Construct a SpotifyAdapter instance using a minimal fake auth object (matching whatever shape spotifyFetch expects — read spotifyFetch.ts to confirm the auth param shape).

Write the following test cases, grouped under describe('SpotifyAdapter — playback'):

(a) play() calls GET /me/player/devices then PUT /me/player/play:
- Mock spotifyFetch to return `{ devices: [{ id: 'device-1', is_active: true }] }` on the first call (devices fetch), then resolve void on the second call (play PUT).
- Call adapter.play('spotify:track:abc').
- Assert spotifyFetch was called twice.
- Assert first call path includes '/me/player/devices'.
- Assert second call path includes '/me/player/play' and method is 'PUT'.

(b) play() throws PlatformError(NO_ACTIVE_DEVICE) when devices array is empty:
- Mock spotifyFetch to return `{ devices: [] }` on the devices call.
- Assert adapter.play('spotify:track:abc') rejects with a PlatformError whose code is PlatformErrorCode.NO_ACTIVE_DEVICE.

(c) cachedDeviceId is cleared on NO_ACTIVE_DEVICE error:
- Seed the adapter's cachedDeviceId to a non-null value by calling adapter.play() successfully first (use the two-call mock from test (a)).
- Then mock spotifyFetch to return `{ devices: [] }` and call adapter.play() again.
- Assert the second call throws NO_ACTIVE_DEVICE (confirming the cached id was not used to bypass device detection when the device is now gone).

(d) pause() calls PUT /me/player/pause:
- Mock spotifyFetch to resolve void.
- Call adapter.pause().
- Assert spotifyFetch was called once with a path containing '/me/player/pause' and method 'PUT'.

(e) seek() calls PUT /me/player/seek?position_ms=N:
- Mock spotifyFetch to resolve void.
- Call adapter.seek(30000).
- Assert spotifyFetch was called once with a path containing '/me/player/seek' and 'position_ms=30000', method 'PUT'.

Use beforeEach to reset all mocks (jest.resetAllMocks()).
</action>

<verify>
  <automated>npx jest --watchAll=false --testPathPattern="SpotifyAdapter.playback"</automated>
</verify>

<acceptance_criteria>
- src/adapters/spotify/__tests__/SpotifyAdapter.playback.test.ts exists
- All five test cases (a)–(e) pass
- spotifyFetch is mocked — no real HTTP calls are made
- `npx jest --watchAll=false --testPathPattern="SpotifyAdapter.playback"` exits 0
</acceptance_criteria>
</task>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TrackPlayer → MusicPlatformAdapter | All Spotify API calls stay inside SpotifyAdapter; TrackPlayer only sees MusicPlatformAdapter |
| SpotifyAdapter → Spotify Web API | spotifyFetch() handles auth, token refresh, error mapping |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04-01 | Information Disclosure | SpotifyAdapter — Spotify tokens | accept | Tokens never leave the device; spotifyFetch() handles token lifecycle in SecureStore (Phase 1). TrackPlayer never sees tokens |
| T-02-04-02 | Elevation of Privilege | TrackPlayer — callers outside adapters/ calling Spotify directly | mitigate | ESLint no-spotify-outside-adapters rule (Phase 1) blocks direct Spotify imports; enforced at lint time |
| T-02-04-03 | Denial of Service | Spotify Connect — play() loops on NO_ACTIVE_DEVICE | mitigate | Cache invalidated on NO_ACTIVE_DEVICE; TrackPlayer falls back to preview on first failure — no retry loop |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
- `npx jest --watchAll=false --testPathPattern="SpotifyAdapter.playback"` exits 0
- No file in src/player/ imports from src/adapters/spotify/
</verification>

<success_criteria>
- SpotifyAdapter playback methods are real implementations (not stubs)
- All five playback behaviours are verified by automated tests (no manual inspection required)
- TrackPlayer abstracts both Spotify Connect and preview fallback behind a single play() call
- SegmentNavigator tap zones are correctly separated for left (seek back) and right (seek forward) halves
</success_criteria>

<output>
Create `.planning/phases/02-swipe-core/02-04-SUMMARY.md` when done
</output>
