---
id: 02-PLAN-05
title: PlaylistWriter + SessionTracker + BackendSync services + unit tests
wave: 2
depends_on:
  - 02-PLAN-03
files_modified:
  - src/services/PlaylistWriter.ts
  - src/services/SessionTracker.ts
  - src/services/BackendSync.ts
  - src/services/__tests__/PlaylistWriter.test.ts
  - src/services/__tests__/SessionTracker.test.ts
  - src/services/__tests__/BackendSync.test.ts
autonomous: true
requirements_addressed:
  - REQ-001
  - REQ-004
  - REQ-005
---

# Plan 05: Client Services — PlaylistWriter, SessionTracker, BackendSync

## Objective

Build the three fire-and-forget services that run alongside the swipe engine. These services are called from the swipe handler but must NEVER block the card advance. Each service is a plain TypeScript class (no React) so it can be unit-tested without a device.

Purpose: SwipeEngine (Plan 06) depends on these services. Plans 05 and 04 are both Wave 2 and can execute in parallel.

Output: Three service files under `src/services/` and their unit test files.

## Interfaces

PlaylistWriter depends on MusicPlatformAdapter:
```typescript
// From src/adapters/interface.ts
addToPlaylist(playlistId: string, trackId: string): Promise<void>
saveToLibrary(trackId: string): Promise<void>
PlatformError, PlatformErrorCode.RATE_LIMITED
```

BackendSync calls backend endpoints from Plan 03:
```
POST /swipes   — body: { swipes: SwipePayload[] }
               — auth: Authorization: Bearer <supabaseToken>
               — response: { inserted: N, updated: M }
```

SessionTracker calls backend endpoints from Plan 03:
```
POST /sessions  — body: { sourcePlaylistId: string }
               — response: { id: string }
PATCH /sessions/:id — body: { endedAt?, swiped?, liked?, superLiked? }
```

## Tasks

<task id="T02-05-1" tdd="true">
<title>Task 1: PlaylistWriter service with parallel writes and exponential backoff</title>

<read_first>
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 5 — full PlaylistWriter implementation with executeWithBackoff; anti-patterns section — do NOT await write() from the swipe handler)
- src/adapters/interface.ts (MusicPlatformAdapter, PlatformError, PlatformErrorCode)
- .planning/REQUIREMENTS.md (REQ-001 — saveToLibrary in superLike; REQ-005 — parallel writes to N playlists)
</read_first>

<behavior>
write(trackId, ['pl-1', 'pl-2']):
- Calls adapter.addToPlaylist('pl-1', trackId) AND adapter.addToPlaylist('pl-2', trackId) in parallel (both start before either resolves)
- Does not await — returns void immediately (fire-and-forget)
- If addToPlaylist throws RATE_LIMITED: retries up to MAX_ATTEMPTS=5 with exponential backoff (BASE_DELAY_MS * 2^attempt + jitter)
- If addToPlaylist throws a non-RATE_LIMITED error on first attempt: logs warning, does not retry, does not throw to caller
- If all 5 attempts fail: logs warning, does not throw to caller

superLike(trackId, ['pl-1']):
- Calls write(trackId, ['pl-1']) AND adapter.saveToLibrary(trackId) concurrently (both fire-and-forget)
- saveToLibrary failure is swallowed (console.warn only)

write(trackId, []):
- No addToPlaylist calls made; returns immediately
</behavior>

<action>
Create src/services/PlaylistWriter.ts following Pattern 5 from RESEARCH.md.

Constants at the top of the file:
- MAX_ATTEMPTS = 5
- BASE_DELAY_MS = 1000

Private function executeWithBackoff(job, adapter): for loop, retries on RATE_LIMITED only, exponential delay with Math.random()*500 jitter, console.warn on failure.

PlaylistWriter class:
- Constructor: (adapter: MusicPlatformAdapter)
- write(trackId: string, destinationPlaylistIds: string[]): void — maps destinations to executeWithBackoff calls, fires Promise.all without await, catches at outer level
- superLike(trackId: string, destinationPlaylistIds: string[]): void — calls this.write(...) AND this.adapter.saveToLibrary(trackId).catch(warn) — both fire-and-forget

Create src/services/__tests__/PlaylistWriter.test.ts:
- Mock adapter with jest.fn() for addToPlaylist and saveToLibrary
- Test parallel write: spy on addToPlaylist; after write() resolves, confirm both calls were made
- Test retry: addToPlaylist rejects with RATE_LIMITED on first 2 attempts then resolves; confirm it was called 3 times
- Test non-retryable error: addToPlaylist throws Error('not a platform error'); confirm called once and no throw to caller
- Test superLike: confirm both addToPlaylist and saveToLibrary were called
- Note: Because write() is fire-and-forget, tests must use async/await with a small delay or flush promises to confirm internal calls completed. Use jest.useFakeTimers() + jest.runAllTimersAsync() to control backoff delays.
</action>

<verify>
<automated>npx jest --watchAll=false --testPathPattern="PlaylistWriter"</automated>
</verify>

<done>
- src/services/PlaylistWriter.ts exists with write() and superLike() methods
- write() never throws; failures are console.warn only
- write() is void (not Promise<void>) — cannot be awaited from the swipe handler
- superLike() calls both addToPlaylist (via write) and saveToLibrary concurrently
- All behavior tests pass
</done>
</task>

<task id="T02-05-2" tdd="true">
<title>Task 2: SessionTracker + BackendSync services and tests</title>

<read_first>
- .planning/phases/02-swipe-core/02-RESEARCH.md (Code Examples — SessionTracker open/close/increment pattern; Pattern 6 — BackendSync postSwipe and flushPending)
- backend/src/routes/sessions.ts (just created in Plan 03 — confirm exact endpoint path and request/response shapes)
- backend/src/routes/swipes.ts (just created in Plan 03 — confirm POST /swipes payload shape)
- .planning/REQUIREMENTS.md (REQ-004 — session counts; REQ-005 — swipe_destinations in payload)
</read_first>

<behavior>
SessionTracker.openSession(sourcePlaylistId):
- POST /sessions with { sourcePlaylistId }
- Returns the session UUID string from response.id
- On HTTP error: throws Error('Failed to open session: {status}')

SessionTracker.closeSession(sessionId):
- PATCH /sessions/:id with { endedAt: new Date().toISOString() }
- Fire-and-forget acceptable (swallows errors with console.warn)

SessionTracker.incrementCounts(sessionId, { swiped, liked, superLiked }):
- PATCH /sessions/:id with { swiped?, liked?, superLiked? }
- Only includes fields that are non-zero in the body
- Fire-and-forget (swallows errors)

BackendSync.postSwipe(payload):
- POST /swipes with { swipes: [payload] }
- Fire-and-forget: catches and warns on failure
- Does NOT await — returns void

BackendSync.flushPending(pendingSwipes):
- POST /swipes with { swipes: pendingSwipes }
- Returns Promise<void> — awaitable (this IS awaited by the reconnect handler)
- Throws on HTTP error so the caller can decide whether to clear pendingSyncSwipes
- If pendingSwipes is empty array: no-op, returns immediately
</behavior>

<action>
Create src/services/SessionTracker.ts:
- Constructor: (backendUrl: string, token: string)
- openSession(sourcePlaylistId: string): Promise<string> — POST /sessions, return id
- closeSession(sessionId: string): void — fire-and-forget PATCH; swallow errors
- incrementCounts(sessionId: string, delta: { swiped?: number; liked?: number; superLiked?: number }): void — fire-and-forget PATCH; send only non-zero fields

Create src/services/BackendSync.ts:
- Constructor: (backendUrl: string, token: string)
- postSwipe(payload: SwipePayload): void — fire-and-forget POST /swipes with single-element array; swallow errors
- flushPending(pendingSwipes: SwipePayload[]): Promise<void> — awaitable POST /swipes; throw on failure

Define SwipePayload interface in BackendSync.ts (or a shared types file):
```typescript
interface SwipePayload {
  sessionId: string;
  trackId: string;
  status: 'liked' | 'super_liked' | 'skipped' | 'pending';
  destinationPlaylistIds: string[];
  swipedAt: string;
}
```

Create src/services/__tests__/SessionTracker.test.ts:
- Mock global fetch with jest.fn()
- Test openSession: fetch returns { id: 'uuid-123' } → resolves 'uuid-123'
- Test openSession on 500: throws Error containing 'Failed to open session'
- Test closeSession: called → fetch called once with PATCH and endedAt in body; errors swallowed
- Test incrementCounts: only liked=1 passed → PATCH body contains liked:1 but not swiped or superLiked

Create src/services/__tests__/BackendSync.test.ts:
- Test postSwipe: fetch is called with POST /swipes and single-element array
- Test postSwipe error: swallowed; no throw to caller
- Test flushPending: fetch called with N-element array
- Test flushPending empty: fetch NOT called
- Test flushPending error: throws (does not swallow)
</action>

<verify>
<automated>npx jest --watchAll=false --testPathPattern="(SessionTracker|BackendSync)"</automated>
</verify>

<done>
- src/services/SessionTracker.ts exists with openSession, closeSession, incrementCounts
- src/services/BackendSync.ts exists with postSwipe (fire-and-forget) and flushPending (awaitable)
- All behavior tests pass
- `npx tsc --noEmit` exits 0
</done>
</task>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| BackendSync → Express API | Supabase JWT included in Authorization header |
| SessionTracker → Express API | Same JWT pattern |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-05-01 | Information Disclosure | SwipePayload — trackId, destinationPlaylistIds in request body | accept | Data is user's own swipe history; JWT-authenticated; no third-party data exposure |
| T-02-05-02 | Tampering | BackendSync — token injected by caller | accept | Token comes from Supabase auth flow (Phase 1 authStore); not from user input |
| T-02-05-03 | Denial of Service | PlaylistWriter — RATE_LIMITED causes 5-attempt retry loop | mitigate | Exponential backoff with jitter prevents thundering herd; after 5 failures writes are silently dropped (acceptable for v1) |
</threat_model>

<verification>
- `npx jest --watchAll=false --testPathPattern="(PlaylistWriter|SessionTracker|BackendSync)"` all pass
- `npx tsc --noEmit` exits 0
- write() in PlaylistWriter has return type void (not Promise)
- flushPending() in BackendSync has return type Promise<void>
</verification>

<success_criteria>
- PlaylistWriter.write() fires all N destination writes in parallel and never blocks the caller
- SuperLike fires both addToPlaylist and saveToLibrary concurrently
- SessionTracker tracks session open/close lifecycle with backend
- BackendSync distinguishes fire-and-forget (postSwipe) from awaitable (flushPending) for reconnect handling
</success_criteria>

<output>
Create `.planning/phases/02-swipe-core/02-05-SUMMARY.md` when done
</output>
