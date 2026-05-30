import express from 'express';
import request from 'supertest';

// Mock the db client before any module that imports it is loaded
jest.mock('../db/client', () => ({
  supabase: {
    from: jest.fn(),
  },
  supabaseAuth: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

import swipesRouter from '../routes/swipes';
import { supabase, supabaseAuth } from '../db/client';

const mockGetUser = (supabaseAuth as unknown as { auth: { getUser: jest.Mock } }).auth.getUser;
const mockFrom = supabase.from as jest.Mock;

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/swipes', swipesRouter);
  return app;
}

const VALID_USER_ID = 'user-uuid-abc';
const OTHER_USER_ID = 'other-user-uuid';
const VALID_TOKEN = 'Bearer valid-token';
const SESSION_ID = 'session-uuid-111';
const TRACK_ID_1 = 'spotify:track:aaa';
const TRACK_ID_2 = 'spotify:track:bbb';
const PLAYLIST_A = 'spotify:playlist:ppp';
const PLAYLIST_B = 'spotify:playlist:qqq';
const SWIPE_ID_1 = 'swipe-uuid-001';
const SWIPE_ID_2 = 'swipe-uuid-002';

// Also queues a mockReturnValueOnce for the users-table lookup that requireAuth
// now performs to resolve supabase_id → custom users.id.
function authenticateAs(userId: string = VALID_USER_ID): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockFrom.mockReturnValueOnce(makeQueryMock({ data: { id: userId }, error: null }));
}

function unauthenticated(): void {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: new Error('Invalid JWT'),
  });
}

/**
 * Creates a mock Supabase query builder chain where every method returns `this`
 * until the terminal call, which resolves with the given value.
 *
 * Terminal methods supported: `in`, `match`, `maybeSingle`, `single`.
 * All others (select, eq, update, delete, insert) return `this`.
 */
function makeQueryMock(resolvedValue: { data: unknown; error: unknown }) {
  const mock: Record<string, jest.Mock> = {};

  const returnSelf = jest.fn().mockReturnValue(mock);
  const returnResolved = jest.fn().mockResolvedValue(resolvedValue);

  // Chain methods that return `this`
  for (const method of ['select', 'eq', 'update', 'delete']) {
    mock[method] = returnSelf;
  }

  // Terminal methods that resolve with value
  for (const method of ['in', 'match', 'maybeSingle', 'single']) {
    mock[method] = returnResolved;
  }

  // insert resolves directly (no further chaining in most paths)
  mock['insert'] = returnResolved;

  return mock;
}

/**
 * Creates a mock for insert + select (used when inserting and getting back IDs).
 */
function makeInsertSelectMock(resolvedValue: { data: unknown; error: unknown }) {
  const selectMock = jest.fn().mockResolvedValue(resolvedValue);
  const insertMock = jest.fn().mockReturnValue({ select: selectMock });
  return { insert: insertMock, select: selectMock };
}

/**
 * Creates a mock Supabase query builder where match() is chainable (returns self)
 * and eq() is the terminal that resolves. Used for GET /swipes?session_id= path
 * where .match(filters).eq('session_id', id) is the query chain.
 */
function makeMatchEqMock(resolvedValue: { data: unknown; error: unknown }) {
  const mock: Record<string, jest.Mock> = {};

  const returnSelf = jest.fn().mockReturnValue(mock);
  const returnResolved = jest.fn().mockResolvedValue(resolvedValue);

  for (const method of ['select', 'match', 'delete', 'update']) {
    mock[method] = returnSelf;
  }

  mock['eq'] = returnResolved;
  mock['in'] = returnResolved;
  mock['maybeSingle'] = returnResolved;
  mock['single'] = returnResolved;
  mock['insert'] = returnResolved;

  return mock;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /swipes
// ---------------------------------------------------------------------------
describe('POST /swipes', () => {
  it('returns 401 when no auth token is provided', async () => {
    unauthenticated();

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(401);
  });

  it('returns 400 when swipes is missing', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'swipes must be a non-empty array' });
  });

  it('returns 400 when swipes is an empty array', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [] });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'swipes must be a non-empty array' });
  });

  it('returns 400 when a swipe entry has an invalid status', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'disliked' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it('returns 400 when a swipe entry is missing spotifyTrackId', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, status: 'liked' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/spotifyTrackId is required/);
  });

  it('returns 400 when a swipe entry is missing sessionId', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionId is required/);
  });

  it('returns 404 when the session does not belong to the user', async () => {
    authenticateAs();

    // 1: session ownership — returns a session owned by someone else
    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: OTHER_USER_ID }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Session not found/);
  });

  it('returns 404 when the session does not exist', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({ data: [], error: null });
    mockFrom.mockReturnValueOnce(sessionMock);

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(404);
  });

  it('returns 200 { inserted, updated } for a batch of new swipes', async () => {
    authenticateAs();

    // 1: session ownership — user owns the session
    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID }],
      error: null,
    });

    // 2: existing swipes — none exist
    const existingMock = makeQueryMock({ data: [], error: null });

    // 3: insert new swipes (insert + select chain)
    const insertSwipesMock = makeInsertSelectMock({
      data: [
        { id: SWIPE_ID_1, session_id: SESSION_ID, spotify_track_id: TRACK_ID_1 },
        { id: SWIPE_ID_2, session_id: SESSION_ID, spotify_track_id: TRACK_ID_2 },
      ],
      error: null,
    });

    // 4: insert destinations for swipe 1 (only swipe 1 has destinations)
    const destInsert1Mock = makeQueryMock({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(sessionMock)       // sessions ownership
      .mockReturnValueOnce(existingMock)      // existing swipes
      .mockReturnValueOnce(insertSwipesMock)  // insert swipes
      .mockReturnValueOnce(destInsert1Mock);  // swipe_destinations for swipe 1

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            destinationPlaylistIds: [PLAYLIST_A],
          },
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_2,
            status: 'skipped',
            destinationPlaylistIds: [],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ inserted: 2, updated: 0 });
    expect(insertSwipesMock.insert).toHaveBeenCalledWith([
      {
        session_id: SESSION_ID,
        user_id: VALID_USER_ID,
        spotify_track_id: TRACK_ID_1,
        status: 'liked',
      },
      {
        session_id: SESSION_ID,
        user_id: VALID_USER_ID,
        spotify_track_id: TRACK_ID_2,
        status: 'skipped',
      },
    ]);
    expect(destInsert1Mock['insert']).toHaveBeenCalledWith([
      { swipe_id: SWIPE_ID_1, spotify_playlist_id: PLAYLIST_A },
    ]);
  });

  it('returns 200 { inserted: 0, updated: 1 } when updating an existing swipe', async () => {
    authenticateAs();

    // 1: session ownership
    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID }],
      error: null,
    });

    // 2: existing swipes — swipe already exists
    const existingMock = makeQueryMock({
      data: [{ id: SWIPE_ID_1, session_id: SESSION_ID, spotify_track_id: TRACK_ID_1 }],
      error: null,
    });

    // 3: update the swipe's status (update + eq chain)
    const updateMock = makeQueryMock({ data: null, error: null });

    // 4: delete old destinations
    const deleteDestMock = makeQueryMock({ data: null, error: null });

    // 5: re-insert new destinations
    const insertDestMock = makeQueryMock({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(sessionMock)
      .mockReturnValueOnce(existingMock)
      .mockReturnValueOnce(updateMock)       // swipes update
      .mockReturnValueOnce(deleteDestMock)   // swipe_destinations delete
      .mockReturnValueOnce(insertDestMock);  // swipe_destinations re-insert

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'super_liked',
            destinationPlaylistIds: [PLAYLIST_A, PLAYLIST_B],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ inserted: 0, updated: 1 });
    expect(updateMock['update']).toHaveBeenCalledWith({ status: 'super_liked' });
    expect(deleteDestMock['delete']).toHaveBeenCalled();
    expect(insertDestMock['insert']).toHaveBeenCalledWith([
      { swipe_id: SWIPE_ID_1, spotify_playlist_id: PLAYLIST_A },
      { swipe_id: SWIPE_ID_1, spotify_playlist_id: PLAYLIST_B },
    ]);
  });

  it('returns 500 when session ownership check fails with a database error', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({ data: null, error: new Error('DB error') });
    mockFrom.mockReturnValueOnce(sessionMock);

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to verify session ownership/);
  });

  it('returns 500 when existing swipe fetch fails', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID }],
      error: null,
    });

    const existingMock = makeQueryMock({ data: null, error: new Error('Fetch error') });

    mockFrom
      .mockReturnValueOnce(sessionMock)
      .mockReturnValueOnce(existingMock);

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to fetch existing swipes/);
  });

  it('returns 500 when swipe insert fails', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID }],
      error: null,
    });

    const existingMock = makeQueryMock({ data: [], error: null });

    const insertMock = makeInsertSelectMock({ data: null, error: new Error('Insert failed') });

    mockFrom
      .mockReturnValueOnce(sessionMock)
      .mockReturnValueOnce(existingMock)
      .mockReturnValueOnce(insertMock);

    const app = buildApp();
    const res = await request(tabs)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to insert swipes/);
  });
});

// ---------------------------------------------------------------------------
// GET /swipes
// ---------------------------------------------------------------------------
describe('GET /swipes', () => {
  it('returns 401 when no auth token is provided', async () => {
    unauthenticated();

    const app = buildApp();
    const res = await request(tabs).get('/swipes');

    expect(res.status).toBe(401);
  });

  it('returns 400 when status param is invalid', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(tabs)
      .get('/swipes?status=disliked')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it('returns 200 with swipe list including destinationPlaylistIds', async () => {
    authenticateAs();

    // 1: swipes + sessions join — uses .select().match()
    const swipeMock = makeQueryMock({
      data: [
        {
          id: SWIPE_ID_1,
          session_id: SESSION_ID,
          spotify_track_id: TRACK_ID_1,
          status: 'liked',
          swiped_at: '2026-01-01T00:00:00Z',
          sessions: { source_playlist_id: PLAYLIST_A },
        },
      ],
      error: null,
    });

    // 2: swipe_destinations fetch — uses .select().in()
    const destMock = makeQueryMock({
      data: [{ swipe_id: SWIPE_ID_1, spotify_playlist_id: PLAYLIST_B }],
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(swipeMock)
      .mockReturnValueOnce(destMock);

    const app = buildApp();
    const res = await request(tabs)
      .get('/swipes')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.swipes).toHaveLength(1);
    expect(res.body.swipes[0]).toMatchObject({
      id: SWIPE_ID_1,
      sessionId: SESSION_ID,
      spotifyTrackId: TRACK_ID_1,
      status: 'liked',
      sourcePlaylistId: PLAYLIST_A,
      destinationPlaylistIds: [PLAYLIST_B],
    });
  });

  it('returns 200 with empty swipes array when user has no swipes', async () => {
    authenticateAs();

    const swipeMock = makeQueryMock({ data: [], error: null });
    mockFrom.mockReturnValueOnce(swipeMock);

    const app = buildApp();
    const res = await request(tabs)
      .get('/swipes')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ swipes: [] });
  });

  it('returns 500 when swipe fetch fails', async () => {
    authenticateAs();

    const swipeMock = makeQueryMock({ data: null, error: new Error('DB error') });
    mockFrom.mockReturnValueOnce(swipeMock);

    const app = buildApp();
    const res = await request(tabs)
      .get('/swipes')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to fetch swipes/);
  });

  it('returns 500 when destinations fetch fails', async () => {
    authenticateAs();

    const swipeMock = makeQueryMock({
      data: [
        {
          id: SWIPE_ID_1,
          session_id: SESSION_ID,
          spotify_track_id: TRACK_ID_1,
          status: 'liked',
          swiped_at: '2026-01-01T00:00:00Z',
          sessions: { source_playlist_id: PLAYLIST_A },
        },
      ],
      error: null,
    });

    const destMock = makeQueryMock({ data: null, error: new Error('Dest fetch error') });

    mockFrom
      .mockReturnValueOnce(swipeMock)
      .mockReturnValueOnce(destMock);

    const app = buildApp();
    const res = await request(tabs)
      .get('/swipes')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to fetch swipe destinations/);
  });

  it('passes status and source_playlist_id filters via match()', async () => {
    authenticateAs();

    const swipeMock = makeQueryMock({ data: [], error: null });
    mockFrom.mockReturnValueOnce(swipeMock);

    const app = buildApp();
    const res = await request(tabs)
      .get(`/swipes?status=liked&source_playlist_id=${PLAYLIST_A}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(swipeMock['match']).toHaveBeenCalledWith({
      user_id: VALID_USER_ID,
      status: 'liked',
      'sessions.source_playlist_id': PLAYLIST_A,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /swipes?session_id=
// ---------------------------------------------------------------------------
describe('GET /swipes?session_id=', () => {
  const SESSION_ID_2 = 'session-uuid-222';

  it('returns only swipes for the given session when ownership is valid', async () => {
    authenticateAs();

    // 1: session ownership check
    const sessionOwnershipMock = makeQueryMock({
      data: { id: SESSION_ID, user_id: VALID_USER_ID },
      error: null,
    });

    // 2: swipes query — match + eq(session_id) is terminal
    const swipesMock = makeMatchEqMock({
      data: [
        {
          id: SWIPE_ID_1,
          session_id: SESSION_ID,
          spotify_track_id: TRACK_ID_1,
          status: 'liked',
          swiped_at: '2026-01-01T00:00:00Z',
          sessions: { source_playlist_id: PLAYLIST_A },
        },
      ],
      error: null,
    });

    // 3: destinations fetch
    const destMock = makeQueryMock({
      data: [{ swipe_id: SWIPE_ID_1, spotify_playlist_id: PLAYLIST_B }],
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(sessionOwnershipMock) // sessions ownership
      .mockReturnValueOnce(swipesMock)           // swipes with session_id filter
      .mockReturnValueOnce(destMock);            // swipe_destinations

    const app = buildApp();
    const res = await request(tabs)
      .get(`/swipes?session_id=${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.swipes).toHaveLength(1);
    expect(res.body.swipes[0]).toMatchObject({
      id: SWIPE_ID_1,
      sessionId: SESSION_ID,
      spotifyTrackId: TRACK_ID_1,
      status: 'liked',
    });
  });

  it('returns 200 empty array for a session with no swipes', async () => {
    authenticateAs();

    const sessionOwnershipMock = makeQueryMock({
      data: { id: SESSION_ID_2, user_id: VALID_USER_ID },
      error: null,
    });

    const swipesMock = makeMatchEqMock({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(sessionOwnershipMock)
      .mockReturnValueOnce(swipesMock);

    const app = buildApp();
    const res = await request(tabs)
      .get(`/swipes?session_id=${SESSION_ID_2}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ swipes: [] });
  });

  it('returns 404 when session_id belongs to a different user', async () => {
    authenticateAs('attacker-user-id');

    const sessionOwnershipMock = makeQueryMock({
      data: { id: SESSION_ID, user_id: VALID_USER_ID }, // owned by original user
      error: null,
    });

    mockFrom.mockReturnValueOnce(sessionOwnershipMock);

    const app = buildApp();
    const res = await request(tabs)
      .get(`/swipes?session_id=${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Session not found' });
  });

  it('returns 404 when session_id does not exist', async () => {
    authenticateAs();

    const sessionOwnershipMock = makeQueryMock({
      data: null,
      error: null,
    });

    mockFrom.mockReturnValueOnce(sessionOwnershipMock);

    const app = buildApp();
    const res = await request(tabs)
      .get('/swipes?session_id=nonexistent-session')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Session not found' });
  });

  it('returns 500 when session ownership check fails with a database error', async () => {
    authenticateAs();

    const sessionOwnershipMock = makeQueryMock({
      data: null,
      error: new Error('DB error'),
    });

    mockFrom.mockReturnValueOnce(sessionOwnershipMock);

    const app = buildApp();
    const res = await request(tabs)
      .get(`/swipes?session_id=${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to verify session ownership' });
  });
});
