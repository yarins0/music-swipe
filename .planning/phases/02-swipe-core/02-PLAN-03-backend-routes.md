---
id: 02-PLAN-03
title: Backend Routes — POST /sessions, PATCH /sessions/:id, POST /swipes, GET /swipes
wave: 1
depends_on: []
files_modified:
  - backend/src/routes/sessions.ts
  - backend/src/routes/swipes.ts
  - backend/src/index.ts
  - backend/src/__tests__/sessions.test.ts
  - backend/src/__tests__/swipes.test.ts
autonomous: true
requirements_addressed:
  - REQ-002
  - REQ-004
  - REQ-005
---

# Plan 03: Backend Swipe & Session Routes

## Objective

Add the two new backend route files (`sessions.ts` and `swipes.ts`) and register them in `index.ts`. All four endpoints are required by Phase 2 clients:

- `POST /sessions` — creates a new session record, returns the session UUID
- `PATCH /sessions/:id` — updates `ended_at`, `swiped_count`, `liked_count`, `super_liked_count`
- `POST /swipes` — accepts a batch of swipe records; upserts by `(session_id, spotify_track_id)` to handle duplicate flushes; inserts into `swipe_destinations` for each record
- `GET /swipes?status=pending&source_playlist_id=X` — returns all pending-status swipes for the authenticated user and source playlist

Purpose: Backend sync and session lifecycle require these routes before Wave 2 can build the client services that call them.

Output: `backend/src/routes/sessions.ts`, `backend/src/routes/swipes.ts`, updated `backend/src/index.ts`, and integration tests for both route files.

## Interfaces

The schema established in Phase 1 (schema.sql) provides these tables — executors must understand them before implementing routes:

```sql
-- sessions table
id UUID PRIMARY KEY, user_id UUID NOT NULL, source_playlist_id TEXT NOT NULL,
started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
swiped_count INT DEFAULT 0, liked_count INT DEFAULT 0, super_liked_count INT DEFAULT 0

-- swipes table
id UUID PRIMARY KEY, session_id UUID NOT NULL, user_id UUID NOT NULL,
spotify_track_id TEXT NOT NULL, status TEXT CHECK (status IN ('liked','super_liked','skipped','pending')),
swiped_at TIMESTAMPTZ

-- swipe_destinations table
id UUID PRIMARY KEY, swipe_id UUID NOT NULL, spotify_playlist_id TEXT NOT NULL
```

The `requireAuth` middleware is already implemented in `backend/src/middleware/auth.ts`. It reads `Authorization: Bearer <supabase-jwt>`, verifies via `supabase.auth.getUser()`, and sets `req.userId` (string UUID).

## Tasks

<task id="T02-03-1" tdd="true">
<title>Task 1: sessions.ts — POST and PATCH /sessions routes</title>

<read_first>
- backend/src/routes/auth.ts (established route file pattern — Router(), async handlers, res.json, error handling shape)
- backend/src/middleware/auth.ts (requireAuth middleware — MUST apply to both routes)
- backend/src/db/client.ts (supabase client import path)
- backend/src/db/schema.sql (sessions table columns and types)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Code Examples — SessionTracker pattern showing what data each endpoint must accept/return)
- .planning/REQUIREMENTS.md (REQ-004 — what session fields must be tracked)
</read_first>

<behavior>
POST /sessions:
- Missing or empty sourcePlaylistId → 400 { error: 'sourcePlaylistId is required' }
- Valid body → insert into sessions with user_id=req.userId, source_playlist_id=body.sourcePlaylistId → return 201 { id: <uuid> }

PATCH /sessions/:id:
- Session not found OR session.user_id !== req.userId → 404 { error: 'Session not found' }
- Accepts body fields: endedAt (ISO string), swiped (number), liked (number), superLiked (number)
- Updates only the fields present in the body (partial update)
- endedAt maps to ended_at column, swiped → swiped_count += swiped, liked → liked_count += liked, superLiked → super_liked_count += superLiked
- Counts use SQL increment (not overwrite) to handle concurrent PATCH calls correctly
- Returns 200 { ok: true }
</behavior>

<action>
Create backend/src/routes/sessions.ts.

Apply requireAuth to both routes.

POST /sessions handler:
1. Validate req.body.sourcePlaylistId is present and non-empty string; return 400 if missing.
2. Insert into sessions: { user_id: req.userId, source_playlist_id: sourcePlaylistId }.
3. Return 201 { id: data.id }.

PATCH /sessions/:id handler:
1. Fetch session from DB by id. If missing → 404.
2. Compare session.user_id to req.userId. If different → 404 (do not reveal existence to other users).
3. Build update object from body fields. Use Supabase's increment for count fields:
   - If body.swiped is a number: use `{ swiped_count: supabase.rpc(...) }` or raw SQL. Use Supabase's `{ count: { increment: body.swiped } }` pattern — or simpler: read current counts, add, write. Prefer the simpler add approach for v1.
   - If body.endedAt is a string: set ended_at = body.endedAt.
4. Return 200 { ok: true }.

Create backend/src/__tests__/sessions.test.ts using supertest and jest. Mock the supabase client (jest.mock('../db/client')). Test the four behaviors listed above. Import the router and mount it in a minimal express app for testing.
</action>

<verify>
<automated>cd backend && npx jest --watchAll=false --testPathPattern="sessions" 2>/dev/null || npx jest --watchAll=false --testPathPattern="sessions"</automated>
</verify>

<done>
- backend/src/routes/sessions.ts exists with POST /sessions and PATCH /sessions/:id
- Both routes are protected by requireAuth
- PATCH verifies session.user_id === req.userId before writing
- All behavior tests pass
</done>
</task>

<task id="T02-03-2" tdd="true">
<title>Task 2: swipes.ts — POST /swipes (batch upsert) + GET /swipes?status=pending, then register both routers</title>

<read_first>
- backend/src/routes/auth.ts (route pattern)
- backend/src/middleware/auth.ts (requireAuth)
- backend/src/db/schema.sql (swipes table CHECK constraint, swipe_destinations table)
- backend/src/index.ts (where to register new routers — import and app.use pattern)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 6 — SwipePayload shape, batch upsert requirement; Security Domain — validate status enum, verify session ownership before writing)
- .planning/REQUIREMENTS.md (REQ-002 — four-value status enum; REQ-005 — swipe_destinations join table)
</read_first>

<behavior>
POST /swipes:
- Body must contain swipes array (non-empty); missing or empty → 400 { error: 'swipes array is required' }
- Each swipe record: { sessionId, trackId, status, destinationPlaylistIds, swipedAt }
- If any status value is not in ['liked','super_liked','skipped','pending'] → 400 { error: 'Invalid status value' } (validate before any DB writes)
- For each record: verify the session exists AND session.user_id === req.userId; if mismatch → 403 { error: 'Forbidden' }
- Upsert into swipes by (session_id, spotify_track_id): if a record with the same session_id and spotify_track_id exists, update its status and swiped_at; otherwise insert new row
- After upsert, delete existing swipe_destinations for the swipe_id and re-insert from destinationPlaylistIds (handles re-sync of changed destinations)
- Returns 200 { inserted: N, updated: M }

GET /swipes?status=pending&source_playlist_id=X:
- Requires both query params; missing → 400
- status must be one of the four valid values; invalid → 400
- Returns swipes where user_id=req.userId AND status=status AND session.source_playlist_id=source_playlist_id
- Join sessions table to filter by source_playlist_id
- Returns 200 { swipes: [{ id, spotify_track_id, status, swiped_at, destination_playlist_ids: string[] }] }
</behavior>

<action>
Create backend/src/routes/swipes.ts.

Apply requireAuth to both routes.

POST /swipes:
1. Validate body.swipes is a non-empty array.
2. Validate each record's status against the allowed set. Return 400 on first invalid value found.
3. For each record in the batch:
   a. Verify req.userId matches the session's user_id (fetch session by sessionId).
   b. Upsert into swipes table. Supabase supports `.upsert()` with `onConflict`. Add a unique constraint on (session_id, spotify_track_id) if not already present (add migration note in a comment — the Phase 1 schema does not have this unique constraint; add it as an inline migration check or via separate SQL).
   c. Delete existing swipe_destinations for the swipe row and re-insert destination rows.
4. Return 200 { inserted, updated } counts.

GET /swipes:
1. Validate status query param.
2. Join sessions to filter by source_playlist_id and user_id.
3. For each swipe returned, also fetch its destination_playlist_ids via swipe_destinations.
4. Return formatted array.

Update backend/src/index.ts:
- Import sessionsRouter from './routes/sessions'
- Import swipesRouter from './routes/swipes'
- Add app.use('/sessions', sessionsRouter) and app.use('/swipes', swipesRouter) before the 404 handler

Create backend/src/__tests__/swipes.test.ts with supertest tests for the four behaviors listed above, plus the forbidden-session case. Mock supabase client.
</action>

<verify>
<automated>cd backend && npx jest --watchAll=false --testPathPattern="swipes" 2>/dev/null || npx jest --watchAll=false --testPathPattern="swipes"</automated>
</verify>

<done>
- backend/src/routes/swipes.ts exists with POST /swipes and GET /swipes
- backend/src/index.ts registers /sessions and /swipes routers
- POST /swipes upserts by (session_id, spotify_track_id) — idempotent on duplicate flush
- POST /swipes validates status enum server-side and verifies session ownership
- All behavior tests pass
</done>
</task>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Mobile client → Express API | Supabase JWT verified by requireAuth middleware |
| Express API → Supabase DB | Server-side query; user_id from verified JWT, not from request body |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-03-01 | Spoofing | POST /swipes — writing swipes to another user's session | mitigate | Verify session.user_id === req.userId before any write; return 403 on mismatch |
| T-02-03-02 | Tampering | POST /swipes — invalid status enum injected | mitigate | Validate status against ['liked','super_liked','skipped','pending'] before DB write; DB CHECK constraint also enforces this |
| T-02-03-03 | Repudiation | POST /swipes — duplicate batch flush writes duplicate records | mitigate | Upsert by (session_id, spotify_track_id) — idempotent; duplicates overwrite but do not multiply |
| T-02-03-04 | Spoofing | PATCH /sessions/:id — user patches another user's session counts | mitigate | Fetch session, compare session.user_id to req.userId; return 404 (not 403, to avoid revealing existence) |
| T-02-03-SC | Tampering | npm/pip installs | accept | No new packages installed in this plan; backend dependencies were established in Phase 1 |
</threat_model>

<verification>
- `cd backend && npx jest --watchAll=false` all pass (sessions + swipes tests)
- backend/src/index.ts mounts /sessions and /swipes routes
- POST /swipes with a duplicate (session_id, spotify_track_id) pair returns 200 (not 409)
</verification>

<success_criteria>
- All four endpoints exist and are protected by requireAuth
- POST /swipes is idempotent on duplicate flush (upsert semantics)
- GET /swipes returns pending tracks with their destination_playlist_ids for cross-session queue injection
- Session ownership is verified on every write endpoint
</success_criteria>

<output>
Create `.planning/phases/02-swipe-core/02-03-SUMMARY.md` when done
</output>
