---
id: 01-PLAN-02
title: Backend Scaffold & Database Schema
wave: 1
depends_on: []
files_modified:
  - backend/src/index.ts
  - backend/src/middleware/auth.ts
  - backend/src/routes/auth.ts
  - backend/src/routes/users.ts
  - backend/src/db/client.ts
  - backend/src/db/schema.sql
  - backend/package.json
  - backend/.env.example
autonomous: true
requirements_addressed:
  - REQ-002
  - REQ-004
  - REQ-005
---

# Plan 02: Backend Scaffold & Database Schema

## Objective

Initialize the Express backend with middleware stack, Supabase client, JWT auth middleware, PostgreSQL schema for all 6 tables (users, playlists, tracks, sessions, swipes, swipe_destinations), and the first two working endpoints: `POST /auth/register` and `GET /users/me`.

This plan is Wave 1 and runs in parallel with Plan 01. It has no dependency on the adapter interface.

## Tasks

<task id="T02-01">
<title>Initialize backend package.json and dependencies</title>

<read_first>
- backend/package.json (current contents — check what already exists)
- CLAUDE.md (backend commands: npm run dev, npm test, npm run lint)
</read_first>

<action>
Ensure backend/package.json has these dependencies installed:
- express ^4.18
- @supabase/supabase-js ^2
- helmet ^7
- cors ^2
- dotenv ^16
- pg ^8 (optional — Supabase JS client handles DB access)

Dev dependencies:
- typescript ^5
- @types/express
- @types/cors
- @types/node
- ts-node
- nodemon
- eslint

Scripts:
- "dev": "nodemon --exec ts-node src/index.ts"
- "build": "tsc"
- "start": "node dist/index.js"
- "test": "jest"
- "lint": "eslint src --ext .ts"

Create tsconfig.json in backend/ if missing:
- target: ES2020, module: commonjs, strict: true, outDir: ./dist, rootDir: ./src
</action>

<acceptance_criteria>
- `cd backend && npm install` exits 0
- `cd backend && npm run build` exits 0
- backend/tsconfig.json exists with strict: true
</acceptance_criteria>
</task>

<task id="T02-02">
<title>Create backend/src/db/schema.sql</title>

<read_first>
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 9 — PostgreSQL schema)
- .planning/REQUIREMENTS.md (REQ-002 swipe status enum, REQ-004 sessions table, REQ-005 swipe_destinations)
- .planning/notes/multi-destination-playlists.md (swipe_destinations data model)
- .planning/notes/decide-later-session-persistence.md (pending status, cross-session queries)
</read_first>

<action>
Create backend/src/db/schema.sql with these tables in order (respecting FK dependencies):

1. users: id (UUID PK), supabase_id (UUID UNIQUE NOT NULL), spotify_user_id (TEXT UNIQUE NOT NULL), display_name (TEXT), email (TEXT), created_at (TIMESTAMPTZ DEFAULT now())

2. playlists: id (UUID PK), spotify_playlist_id (TEXT UNIQUE NOT NULL), owner_id (UUID REFERENCES users), name (TEXT NOT NULL), cover_art_url (TEXT), track_count (INT), cached_at (TIMESTAMPTZ DEFAULT now())

3. tracks: id (UUID PK), spotify_track_id (TEXT UNIQUE NOT NULL), title (TEXT NOT NULL), artist (TEXT NOT NULL), album (TEXT), album_art_url (TEXT), duration_ms (INT), preview_url (TEXT)

4. sessions: id (UUID PK), user_id (UUID REFERENCES users NOT NULL), source_playlist_id (TEXT NOT NULL), started_at (TIMESTAMPTZ DEFAULT now()), ended_at (TIMESTAMPTZ), swiped_count (INT DEFAULT 0), liked_count (INT DEFAULT 0), super_liked_count (INT DEFAULT 0)

5. swipes: id (UUID PK), session_id (UUID REFERENCES sessions NOT NULL), user_id (UUID REFERENCES users NOT NULL), spotify_track_id (TEXT NOT NULL), status (TEXT NOT NULL CHECK IN ('liked', 'super_liked', 'skipped', 'pending')), swiped_at (TIMESTAMPTZ DEFAULT now())

6. swipe_destinations: id (UUID PK), swipe_id (UUID REFERENCES swipes ON DELETE CASCADE NOT NULL), spotify_playlist_id (TEXT NOT NULL)

Indexes:
- idx_swipes_session ON swipes(session_id)
- idx_swipes_user_status ON swipes(user_id, status)
- idx_swipes_pending ON swipes(user_id, spotify_track_id) WHERE status = 'pending'
- idx_swipe_destinations_swipe ON swipe_destinations(swipe_id)
</action>

<acceptance_criteria>
- backend/src/db/schema.sql exists and contains all 6 CREATE TABLE statements
- schema.sql contains CHECK (status IN ('liked', 'super_liked', 'skipped', 'pending')) on swipes.status
- schema.sql contains swipe_destinations table with ON DELETE CASCADE on swipe_id FK
- schema.sql contains all 4 index definitions
</acceptance_criteria>
</task>

<task id="T02-03">
<title>Create backend/src/db/client.ts (Supabase client)</title>

<read_first>
- backend/src/db/schema.sql (just created)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 4 — Supabase Auth)
</read_first>

<action>
Create backend/src/db/client.ts:
- Import createClient from @supabase/supabase-js
- Read SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env
- If either is missing, throw at startup: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
- Export a single `supabase` client instance using the service role key (not the anon key — service role is needed for admin operations and JWT verification)

Create backend/.env.example:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SPOTIFY_CLIENT_ID=your-spotify-client-id
PORT=3000
```
</action>

<acceptance_criteria>
- backend/src/db/client.ts exports a `supabase` Supabase client
- Startup throws with a clear message if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing
- backend/.env.example exists with all required env vars listed
</acceptance_criteria>
</task>

<task id="T02-04">
<title>Create backend/src/middleware/auth.ts (JWT verification)</title>

<read_first>
- backend/src/db/client.ts (Supabase client)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 4 — requireAuth middleware)
</read_first>

<action>
Create backend/src/middleware/auth.ts:

Export an Express middleware function `requireAuth(req, res, next)`:
1. Read token from Authorization header: `req.headers.authorization?.replace('Bearer ', '')`
2. If no token: return 401 JSON { error: 'Missing authorization token' }
3. Call `supabase.auth.getUser(token)` 
4. If error or no user: return 401 JSON { error: 'Invalid or expired token' }
5. Attach user to request: `req.userId = user.id` (add userId to Express Request type via declaration merging in a types.d.ts file)
6. Call next()

Create backend/src/types.d.ts with:
```ts
declare namespace Express {
  interface Request {
    userId: string;
  }
}
```
</action>

<acceptance_criteria>
- backend/src/middleware/auth.ts exports requireAuth function
- Request without Authorization header returns 401 with JSON body containing 'error' key
- Request with valid Supabase JWT passes through and sets req.userId
- backend/src/types.d.ts declares userId on Express.Request
</acceptance_criteria>
</task>

<task id="T02-05">
<title>Create backend/src/routes/auth.ts (POST /auth/register)</title>

<read_first>
- backend/src/db/client.ts
- backend/src/middleware/auth.ts
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 4 — backend auth flow)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-10, D-11, D-12)
</read_first>

<action>
Create backend/src/routes/auth.ts with Express Router.

POST /auth/register:
- Body: { spotifyAccessToken: string }
- Call Spotify GET /me with the provided token to get { id: spotify_user_id, display_name, email }
- If Spotify returns 401: return 401 JSON { error: 'Invalid Spotify token' }
- Check if user with spotify_user_id already exists in users table
- If new user: insert into users table (supabase_id will be set after Supabase user creation)
  - Create Supabase auth user via `supabase.auth.admin.createUser({ email: \`${spotify_user_id}@MusicSwipe.internal\`, password: crypto.randomUUID(), email_confirm: true })`
  - Update users row with the returned supabase_id
- Generate Supabase session for the user: `supabase.auth.admin.generateLink({ type: 'magiclink', email })` is not ideal; better: sign in with admin createSession if available, otherwise use signInWithPassword after setting a deterministic password
  - Simpler: use `supabase.auth.admin.createSession({ user_id: supabaseUser.id })` to get access_token
- Return: { supabaseToken: session.access_token, userId: supabaseUser.id }

Note: This endpoint must NOT store or log the Spotify access token. It only uses it to call /me and then discards it.
</action>

<acceptance_criteria>
- POST /auth/register with valid Spotify token returns JSON with supabaseToken and userId
- POST /auth/register with invalid Spotify token returns 401
- A new users row exists in the database after first registration with correct spotify_user_id
- Subsequent calls for the same spotify_user_id do not create duplicate users rows
</acceptance_criteria>
</task>

<task id="T02-06">
<title>Create backend/src/routes/users.ts (GET /users/me)</title>

<read_first>
- backend/src/middleware/auth.ts
- backend/src/db/client.ts
</read_first>

<action>
Create backend/src/routes/users.ts with Express Router.

GET /users/me (protected by requireAuth middleware):
- Query: `SELECT id, spotify_user_id, display_name, email, created_at FROM users WHERE supabase_id = $1` using req.userId
- If no user found: return 404 JSON { error: 'User not found' }
- Return: { id, spotifyUserId, displayName, email, createdAt }
</action>

<acceptance_criteria>
- GET /users/me without Authorization header returns 401
- GET /users/me with valid Supabase JWT returns JSON with id, spotifyUserId, displayName, email, createdAt
- GET /users/me with valid JWT for unknown user returns 404
</acceptance_criteria>
</task>

<task id="T02-07">
<title>Create backend/src/index.ts (Express app entry)</title>

<read_first>
- backend/src/routes/auth.ts
- backend/src/routes/users.ts
- backend/src/db/client.ts
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 9 — middleware stack)
</read_first>

<action>
Create backend/src/index.ts:
1. Load dotenv: `import 'dotenv/config'`
2. Create Express app
3. Apply middleware in order: helmet(), cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'] }), express.json({ limit: '1mb' })
4. Mount routes: app.use('/auth', authRouter), app.use('/users', usersRouter)
5. 404 handler: app.use((req, res) => res.status(404).json({ error: 'Not found' }))
6. Global error handler: app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); })
7. Listen on PORT from env (default 3000)
8. Log: `Server running on port ${PORT}`
</action>

<acceptance_criteria>
- `npm run dev` in backend/ starts without error
- GET /nonexistent returns 404 JSON
- POST /auth/register and GET /users/me are reachable at localhost:3000
- `npm run build` compiles to dist/ without TypeScript errors
</acceptance_criteria>
</task>

## Verification

<verification>
### Goal-Backward Check
Phase 1 success criterion 6: "Backend Express server is running with PostgreSQL schema (users, playlists, tracks, sessions, swipes, swipe_destinations)"

This plan delivers all 6 tables and a running Express server with Supabase JWT auth.

### Verification Commands
```bash
cd backend && npm run build    # must exit 0
cd backend && npm run dev      # server must start
curl http://localhost:3000/users/me  # must return 401 (no token)
```
</verification>

<must_haves>
truths:
  - backend/src/db/schema.sql contains all 6 tables including swipe_destinations and sessions
  - swipes.status CHECK constraint includes 'pending' and 'super_liked'
  - requireAuth middleware verifies Supabase JWT on every protected route
  - Backend never stores or logs Spotify access tokens
  - POST /auth/register returns a Supabase token, not a Spotify token
</must_haves>
