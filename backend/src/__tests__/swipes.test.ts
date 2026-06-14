import express from 'express';
import request from 'supertest';

// Mock the db client before any module that imports it is loaded
jest.mock('../db/client', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
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
const mockRpc = supabase.rpc as jest.Mock;

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

/**
 * Queues a successful rpc('upsert_swipes') response. Call this after
 * authenticateAs() and the session-ownership mockFrom, so the rpc mock fires
 * at the right point in the request lifecycle.
 */
function mockRpcSuccess(inserted: number, updated: number): void {
  mockRpc.mockResolvedValueOnce({
    data: { inserted, updated },
    error: null,
  });
}

/**
 * Queues a failing rpc('upsert_swipes') response.
 */
function mockRpcError(message: string): void {
  mockRpc.mockResolvedValueOnce({
    data: null,
    error: new Error(message),
  });
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
    const res = await request(app)
      .post('/swipes')
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(401);
  });

  it('returns 400 when swipes is missing', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'swipes must be a non-empty array' });
  });

  it('returns 400 when swipes is an empty array', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [] });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'swipes must be a non-empty array' });
  });

  it('returns 400 when a swipe entry has an invalid status', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
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
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, status: 'liked' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/spotifyTrackId is required/);
  });

  it('returns 400 when a swipe entry is missing sessionId', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionId is required/);
  });

  it('returns 404 when the session does not belong to the user', async () => {
    authenticateAs();

    // session ownership — returns a session owned by someone else
    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: OTHER_USER_ID }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    const app = buildApp();
    const res = await request(app)
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
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(404);
  });

  it('returns 200 { inserted, updated } for a batch of new swipes and calls rpc with correct args', async () => {
    authenticateAs();

    // Session ownership — user owns the session
    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    // rpc returns inserted: 2, updated: 0
    mockRpcSuccess(2, 0);

    const app = buildApp();
    const res = await request(app)
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

    // Verify rpc was called with correctly-shaped args
    expect(mockRpc).toHaveBeenCalledWith('upsert_swipes', {
      p_user_id: VALID_USER_ID,
      p_swipes: [
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
  });

  it('forwards likedSongsWrittenByUs to rpc only when true', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcSuccess(0, 1);

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'super_liked',
            destinationPlaylistIds: [PLAYLIST_A],
            likedSongsWrittenByUs: true,
          },
        ],
      });

    expect(res.status).toBe(200);
    const rpcArgs = mockRpc.mock.calls[0][1] as { p_swipes: Record<string, unknown>[] };
    expect(rpcArgs.p_swipes[0]).toMatchObject({
      spotifyTrackId: TRACK_ID_1,
      likedSongsWrittenByUs: true,
    });
  });

  it('omits likedSongsWrittenByUs from the rpc payload when false or absent', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcSuccess(1, 0);

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'skipped',
            destinationPlaylistIds: [],
            likedSongsWrittenByUs: false,
          },
        ],
      });

    expect(res.status).toBe(200);
    const rpcArgs = mockRpc.mock.calls[0][1] as { p_swipes: Record<string, unknown>[] };
    expect(rpcArgs.p_swipes[0]).not.toHaveProperty('likedSongsWrittenByUs');
  });

  it('returns 400 when likedSongsWrittenByUs is not a boolean', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            likedSongsWrittenByUs: 'yes',
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'swipes[0].likedSongsWrittenByUs must be a boolean' });
  });

  it('returns 200 { inserted: 0, updated: 1 } when rpc reports an update', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcSuccess(0, 1);

    const app = buildApp();
    const res = await request(app)
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
    expect(mockRpc).toHaveBeenCalledWith('upsert_swipes', {
      p_user_id: VALID_USER_ID,
      p_swipes: [
        {
          sessionId: SESSION_ID,
          spotifyTrackId: TRACK_ID_1,
          status: 'super_liked',
          destinationPlaylistIds: [PLAYLIST_A, PLAYLIST_B],
        },
      ],
    });
  });

  it('returns 500 when session ownership check fails with a database error', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({ data: null, error: new Error('DB error') });
    mockFrom.mockReturnValueOnce(sessionMock);

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to verify session ownership/);
  });

  it('returns 500 when the rpc call fails', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcError('DB write error');

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_ID, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to upsert swipes/);
  });
});

// ---------------------------------------------------------------------------
// POST /swipes — destinationPlaylistIds element validation (L2 fix)
// ---------------------------------------------------------------------------
describe('POST /swipes destinationPlaylistIds element validation', () => {
  // These cases must be rejected before any DB call is made, so no mockFrom
  // values need to be queued beyond the auth mocks set up by authenticateAs().

  it('returns 400 when destinationPlaylistIds contains null', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            destinationPlaylistIds: [null],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must contain only non-empty strings/);
  });

  it('returns 400 when destinationPlaylistIds contains a number', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            destinationPlaylistIds: [123],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must contain only non-empty strings/);
  });

  it('returns 400 when destinationPlaylistIds contains an empty string', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            destinationPlaylistIds: [''],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must contain only non-empty strings/);
  });

  it('returns 400 when destinationPlaylistIds contains a plain object', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            destinationPlaylistIds: [{}],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must contain only non-empty strings/);
  });

  it('returns 400 and includes the correct swipe index in the error message', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            // First swipe is valid
            destinationPlaylistIds: [PLAYLIST_A],
          },
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_2,
            status: 'liked',
            // Second swipe has invalid element
            destinationPlaylistIds: [null],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/swipes\[1\]/);
    expect(res.body.error).toMatch(/must contain only non-empty strings/);
  });

  it('passes validation and proceeds for a valid non-empty string array', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcSuccess(1, 0);

    const app = buildApp();
    const res = await request(app)
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
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inserted: 1, updated: 0 });
  });

  it('passes validation and proceeds when destinationPlaylistIds is omitted', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcSuccess(1, 0);

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'pending',
            // destinationPlaylistIds intentionally absent
          },
        ],
      });

    expect(res.status).toBe(200);
    // Route must normalise missing destinationPlaylistIds to [] before calling rpc
    expect(mockRpc).toHaveBeenCalledWith('upsert_swipes', {
      p_user_id: VALID_USER_ID,
      p_swipes: [
        {
          sessionId: SESSION_ID,
          spotifyTrackId: TRACK_ID_1,
          status: 'pending',
          destinationPlaylistIds: [],
        },
      ],
    });
    expect(res.body).toMatchObject({ inserted: 1, updated: 0 });
  });
});

// ---------------------------------------------------------------------------
// POST /swipes — dangling-pending reconciliation
//
// Reconciliation of stale 'pending' rows moved INTO the upsert_swipes plpgsql
// function (migration 0004, M4), so it now runs inside the RPC's transaction
// rather than as a separate post-commit pass in the route. With supabase.rpc
// fully mocked here, the SQL-side DELETE isn't observable at this layer, so the
// route no longer makes its own reconciliation queries — see the assertions
// below that the POST path issues no follow-up DB calls after the RPC. The
// reconciliation logic itself is covered by migration 0004.
// ---------------------------------------------------------------------------
describe('POST /swipes pending reconciliation (now in upsert_swipes)', () => {
  const SESSION_B = 'session-uuid-bbb';

  it('makes no DB calls after the upsert RPC for a decided swipe', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_B, user_id: VALID_USER_ID }],
      error: null,
    });
    // Exactly two from() calls are expected: the requireAuth user lookup and the
    // session-ownership check. No reconciliation mock is queued — if the route
    // attempted a post-RPC query, from() would return undefined and 500.
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcSuccess(1, 0);

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({ swipes: [{ sessionId: SESSION_B, spotifyTrackId: TRACK_ID_1, status: 'liked' }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ inserted: 1, updated: 0 });
    // requireAuth user lookup (1) + session ownership (1); no reconciliation pass.
    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// POST /swipes — optional track metadata (M7)
// ---------------------------------------------------------------------------
describe('POST /swipes track metadata', () => {
  const TRACK = {
    uri: 'spotify:track:aaa',
    title: 'Song One',
    artist: 'Artist One',
    artists: ['Artist One'],
    album: 'Album One',
    albumArtUrl: 'http://art/1.jpg',
    durationMs: 180000,
    previewUrl: null,
  };

  it('forwards the track object to rpc when present', async () => {
    authenticateAs();

    const sessionMock = makeQueryMock({
      data: [{ id: SESSION_ID, user_id: VALID_USER_ID, source_playlist_id: PLAYLIST_A }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(sessionMock);

    mockRpcSuccess(1, 0);

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            destinationPlaylistIds: [PLAYLIST_A],
            track: TRACK,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('upsert_swipes', {
      p_user_id: VALID_USER_ID,
      p_swipes: [
        {
          sessionId: SESSION_ID,
          spotifyTrackId: TRACK_ID_1,
          status: 'liked',
          destinationPlaylistIds: [PLAYLIST_A],
          track: TRACK,
        },
      ],
    });
  });

  it('returns 400 when track is present but missing title', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            track: { artist: 'Artist One' },
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/track\.title is required/);
  });

  it('returns 400 when track is present but missing artist', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/swipes')
      .set('Authorization', VALID_TOKEN)
      .send({
        swipes: [
          {
            sessionId: SESSION_ID,
            spotifyTrackId: TRACK_ID_1,
            status: 'liked',
            track: { title: 'Song One' },
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/track\.artist is required/);
  });
});

// ---------------------------------------------------------------------------
// GET /swipes
// ---------------------------------------------------------------------------
describe('GET /swipes', () => {
  it('returns 401 when no auth token is provided', async () => {
    unauthenticated();

    const app = buildApp();
    const res = await request(app).get('/swipes');

    expect(res.status).toBe(401);
  });

  it('returns 400 when status param is invalid', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .get('/swipes?status=disliked')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it('returns 400 when source_playlist_id exceeds the max length', async () => {
    authenticateAs();

    const overLongId = 'a'.repeat(256);
    const app = buildApp();
    const res = await request(app)
      .get(`/swipes?source_playlist_id=${overLongId}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source_playlist_id is malformed/);
  });

  it('returns 400 when source_playlist_id contains disallowed characters', async () => {
    authenticateAs();

    const malformedId = encodeURIComponent('bad id/../with spaces');
    const app = buildApp();
    const res = await request(app)
      .get(`/swipes?source_playlist_id=${malformedId}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source_playlist_id is malformed/);
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

    // 3: tracks fetch — uses .select().in()
    const tracksMock = makeQueryMock({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(swipeMock)
      .mockReturnValueOnce(destMock)
      .mockReturnValueOnce(tracksMock);

    const app = buildApp();
    const res = await request(app)
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
      track: null,
    });
  });

  it('joins track metadata onto each swipe and returns null when uncached', async () => {
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
        {
          id: SWIPE_ID_2,
          session_id: SESSION_ID,
          spotify_track_id: TRACK_ID_2,
          status: 'liked',
          swiped_at: '2026-01-01T00:01:00Z',
          sessions: { source_playlist_id: PLAYLIST_A },
        },
      ],
      error: null,
    });
    const destMock = makeQueryMock({ data: [], error: null });
    // Only TRACK_ID_1 has cached metadata; TRACK_ID_2 must come back as track: null.
    const tracksMock = makeQueryMock({
      data: [
        {
          spotify_track_id: TRACK_ID_1,
          title: 'Song One',
          artist: 'Artist One',
          artists: ['Artist One'],
          album: 'Album One',
          album_art_url: 'http://art/1.jpg',
          duration_ms: 180000,
          preview_url: null,
          uri: 'spotify:track:aaa',
        },
      ],
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(swipeMock)
      .mockReturnValueOnce(destMock)
      .mockReturnValueOnce(tracksMock);

    const app = buildApp();
    const res = await request(app).get('/swipes').set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.swipes).toHaveLength(2);
    expect(res.body.swipes[0].track).toMatchObject({
      id: TRACK_ID_1,
      title: 'Song One',
      artist: 'Artist One',
      uri: 'spotify:track:aaa',
    });
    expect(res.body.swipes[1].track).toBeNull();
  });

  it('returns 500 when the tracks fetch fails', async () => {
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
    const destMock = makeQueryMock({ data: [], error: null });
    const tracksMock = makeQueryMock({ data: null, error: new Error('Tracks DB error') });

    mockFrom
      .mockReturnValueOnce(swipeMock)
      .mockReturnValueOnce(destMock)
      .mockReturnValueOnce(tracksMock);

    const app = buildApp();
    const res = await request(app).get('/swipes').set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to fetch tracks/);
  });

  it('returns 200 with empty swipes array when user has no swipes', async () => {
    authenticateAs();

    const swipeMock = makeQueryMock({ data: [], error: null });
    mockFrom.mockReturnValueOnce(swipeMock);

    const app = buildApp();
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
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
// GET /swipes?status=pending — dedupe safety net (Phase 3)
// ---------------------------------------------------------------------------
describe('GET /swipes?status=pending dedupe', () => {
  function pendingRow(swipeId: string, sessionId: string, trackId: string, ts: string) {
    return {
      id: swipeId,
      session_id: sessionId,
      spotify_track_id: trackId,
      status: 'pending',
      swiped_at: ts,
      sessions: { source_playlist_id: PLAYLIST_A },
    };
  }

  it('excludes a track that has already been decided in the playlist', async () => {
    authenticateAs();

    // 1: main pending query (no session_id) — match() is terminal
    const pendingMock = makeQueryMock({
      data: [
        pendingRow(SWIPE_ID_1, SESSION_ID, TRACK_ID_1, 'ts-1'),
        pendingRow(SWIPE_ID_2, SESSION_ID, TRACK_ID_2, 'ts-2'),
      ],
      error: null,
    });
    // 2: decided-tracks query — uses .select().match().in(), so match must be chainable
    const decidedMock = makeMatchEqMock({ data: [{ spotify_track_id: TRACK_ID_1 }], error: null });
    // 3: destinations for the surviving swipe — none
    const destMock = makeQueryMock({ data: [], error: null });
    // 4: tracks for the surviving swipe — none cached
    const tracksMock = makeQueryMock({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(pendingMock)
      .mockReturnValueOnce(decidedMock)
      .mockReturnValueOnce(destMock)
      .mockReturnValueOnce(tracksMock);

    const app = buildApp();
    const res = await request(app)
      .get(`/swipes?status=pending&source_playlist_id=${PLAYLIST_A}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.swipes).toHaveLength(1);
    expect(res.body.swipes[0].spotifyTrackId).toBe(TRACK_ID_2);
  });

  it('collapses duplicate pending rows for the same track to one', async () => {
    authenticateAs();

    const pendingMock = makeQueryMock({
      data: [
        pendingRow(SWIPE_ID_1, SESSION_ID, TRACK_ID_1, 'ts-1'),
        pendingRow(SWIPE_ID_2, 'session-2', TRACK_ID_1, 'ts-2'),
      ],
      error: null,
    });
    const decidedMock = makeMatchEqMock({ data: [], error: null });
    const destMock = makeQueryMock({ data: [], error: null });
    const tracksMock = makeQueryMock({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(pendingMock)
      .mockReturnValueOnce(decidedMock)
      .mockReturnValueOnce(destMock)
      .mockReturnValueOnce(tracksMock);

    const app = buildApp();
    const res = await request(app)
      .get(`/swipes?status=pending&source_playlist_id=${PLAYLIST_A}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.swipes).toHaveLength(1);
    expect(res.body.swipes[0].spotifyTrackId).toBe(TRACK_ID_1);
  });

  it('returns 500 when the decided-tracks dedupe query fails', async () => {
    authenticateAs();

    const pendingMock = makeQueryMock({
      data: [pendingRow(SWIPE_ID_1, SESSION_ID, TRACK_ID_1, 'ts-1')],
      error: null,
    });
    const decidedMock = makeMatchEqMock({ data: null, error: new Error('DB error') });

    mockFrom
      .mockReturnValueOnce(pendingMock)
      .mockReturnValueOnce(decidedMock);

    const app = buildApp();
    const res = await request(app)
      .get(`/swipes?status=pending&source_playlist_id=${PLAYLIST_A}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to fetch swipes/);
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

    // 4: tracks fetch
    const tracksMock = makeQueryMock({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(sessionOwnershipMock) // sessions ownership
      .mockReturnValueOnce(swipesMock)           // swipes with session_id filter
      .mockReturnValueOnce(destMock)             // swipe_destinations
      .mockReturnValueOnce(tracksMock);          // tracks

    const app = buildApp();
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
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
    const res = await request(app)
      .get(`/swipes?session_id=${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to verify session ownership' });
  });
});
