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

import sessionsRouter from '../routes/sessions';
import { supabase, supabaseAuth } from '../db/client';

// Typed mock helpers
const mockGetUser = (supabaseAuth as unknown as { auth: { getUser: jest.Mock } }).auth.getUser;
const mockFrom = supabase.from as jest.Mock;

// Build a minimal express app that mounts only the sessions router
function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/sessions', sessionsRouter);
  return app;
}

const VALID_USER_ID = 'user-uuid-abc';
const VALID_TOKEN = 'Bearer valid-token';
const SESSION_ID = 'session-uuid-123';
const PLAYLIST_ID = 'spotify:playlist:xyz';

// Helper: set up getUser to return a valid authenticated user.
// Also queues a mockReturnValueOnce for the users-table lookup that requireAuth
// now performs to resolve supabase_id → custom users.id.
function authenticateAs(userId: string = VALID_USER_ID): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockFrom.mockReturnValueOnce({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { id: userId }, error: null }),
  });
}

// Helper: set up getUser to fail authentication
function unauthenticated(): void {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: new Error('Invalid JWT'),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /sessions
// ---------------------------------------------------------------------------
describe('POST /sessions', () => {
  it('returns 401 when no auth token is provided', async () => {
    unauthenticated();

    const app = buildApp();
    const res = await request(app).post('/sessions').send({ sourcePlaylistId: PLAYLIST_ID });

    expect(res.status).toBe(401);
  });

  it('returns 400 when sourcePlaylistId is missing', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', VALID_TOKEN)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'sourcePlaylistId is required' });
  });

  it('returns 400 when sourcePlaylistId is not a string', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', VALID_TOKEN)
      .send({ sourcePlaylistId: 42 });

    expect(res.status).toBe(400);
  });

  it('returns 201 with id on success', async () => {
    authenticateAs();

    const mockInsertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: SESSION_ID },
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockInsertChain);

    const app = buildApp();
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', VALID_TOKEN)
      .send({ sourcePlaylistId: PLAYLIST_ID });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: SESSION_ID });
    expect(mockFrom).toHaveBeenCalledWith('sessions');
    expect(mockInsertChain.insert).toHaveBeenCalledWith({
      user_id: VALID_USER_ID,
      source_playlist_id: PLAYLIST_ID,
    });
  });

  it('persists the optional session fields when provided', async () => {
    authenticateAs();

    const mockInsertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: SESSION_ID }, error: null }),
    };
    mockFrom.mockReturnValue(mockInsertChain);

    const app = buildApp();
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', VALID_TOKEN)
      .send({
        sourcePlaylistId: PLAYLIST_ID,
        sourcePlaylistName: 'My Playlist',
        destinationPlaylistIds: ['dest-1'],
        destinationPlaylistNames: ['Dest One'],
        isFilterMode: true,
        totalTracks: 42,
      });

    expect(res.status).toBe(201);
    expect(mockInsertChain.insert).toHaveBeenCalledWith({
      user_id: VALID_USER_ID,
      source_playlist_id: PLAYLIST_ID,
      source_playlist_name: 'My Playlist',
      destination_playlist_ids: ['dest-1'],
      destination_playlist_names: ['Dest One'],
      is_filter_mode: true,
      total_tracks: 42,
    });
  });

  it('returns 400 when destinationPlaylistIds contains a non-string', async () => {
    authenticateAs();

    const app = buildApp();
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', VALID_TOKEN)
      .send({ sourcePlaylistId: PLAYLIST_ID, destinationPlaylistIds: [123] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/destinationPlaylistIds must be an array of strings/);
  });

  it('returns 500 when the database insert fails', async () => {
    authenticateAs();

    const mockInsertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: new Error('DB error'),
      }),
    };
    mockFrom.mockReturnValue(mockInsertChain);

    const app = buildApp();
    const res = await request(app)
      .post('/sessions')
      .set('Authorization', VALID_TOKEN)
      .send({ sourcePlaylistId: PLAYLIST_ID });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to create session' });
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id
// ---------------------------------------------------------------------------
describe('GET /sessions/:id', () => {
  it('returns 401 when no auth token is provided', async () => {
    unauthenticated();

    const app = buildApp();
    const res = await request(app).get(`/sessions/${SESSION_ID}`);

    expect(res.status).toBe(401);
  });

  it('returns 200 with computed counts from swipes table for own session', async () => {
    authenticateAs();

    // First from() call: session ownership check
    const mockSessionChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: SESSION_ID,
          user_id: VALID_USER_ID,
          source_playlist_id: PLAYLIST_ID,
          started_at: '2026-01-01T10:00:00Z',
          ended_at: '2026-01-01T10:30:00Z',
        },
        error: null,
      }),
    };

    // Second from() call: swipes status query.
    // Mix: 5 liked, 2 super_liked, 3 skipped, 1 pending.
    // Expected: swipedCount = 10 (liked+super_liked+skipped), likedCount = 5,
    //           superLikedCount = 2. Pending is excluded.
    const mockSwipesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [
          { status: 'liked' },
          { status: 'liked' },
          { status: 'liked' },
          { status: 'liked' },
          { status: 'liked' },
          { status: 'super_liked' },
          { status: 'super_liked' },
          { status: 'skipped' },
          { status: 'skipped' },
          { status: 'skipped' },
          { status: 'pending' }, // must NOT be counted
        ],
        error: null,
      }),
    };

    mockFrom.mockReturnValueOnce(mockSessionChain).mockReturnValueOnce(mockSwipesChain);

    const app = buildApp();
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: SESSION_ID,
      sourcePlaylistId: PLAYLIST_ID,
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:30:00Z',
      swipedCount: 10,
      likedCount: 5,
      superLikedCount: 2,
    });
  });

  it('returns 200 with all-zero counts when there are no decided swipes', async () => {
    authenticateAs();

    const mockSessionChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: SESSION_ID,
          user_id: VALID_USER_ID,
          source_playlist_id: PLAYLIST_ID,
          started_at: '2026-01-01T10:00:00Z',
          ended_at: null,
        },
        error: null,
      }),
    };

    // Only pending swipes — all counts must be 0
    const mockSwipesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [{ status: 'pending' }, { status: 'pending' }],
        error: null,
      }),
    };

    mockFrom.mockReturnValueOnce(mockSessionChain).mockReturnValueOnce(mockSwipesChain);

    const app = buildApp();
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      swipedCount: 0,
      likedCount: 0,
      superLikedCount: 0,
    });
  });

  it('returns 404 when session belongs to a different user', async () => {
    authenticateAs('attacker-user-id');

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: SESSION_ID, user_id: VALID_USER_ID }, // owned by someone else
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    const app = buildApp();
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Session not found' });
  });

  it('returns 404 when session does not exist', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    const app = buildApp();
    const res = await request(app)
      .get(`/sessions/nonexistent-id`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Session not found' });
  });

  it('returns 500 when the session database fetch fails', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: new Error('Connection error'),
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    const app = buildApp();
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to fetch session' });
  });

  it('returns 500 when the swipes database fetch fails', async () => {
    authenticateAs();

    const mockSessionChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: SESSION_ID,
          user_id: VALID_USER_ID,
          source_playlist_id: PLAYLIST_ID,
          started_at: '2026-01-01T10:00:00Z',
          ended_at: null,
        },
        error: null,
      }),
    };

    const mockSwipesChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: null,
        error: new Error('Swipes DB error'),
      }),
    };

    mockFrom.mockReturnValueOnce(mockSessionChain).mockReturnValueOnce(mockSwipesChain);

    const app = buildApp();
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to fetch session swipes' });
  });
});

// ---------------------------------------------------------------------------
// PATCH /sessions/:id
// ---------------------------------------------------------------------------
describe('PATCH /sessions/:id', () => {
  it('returns 401 when no auth token is provided', async () => {
    unauthenticated();

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .send({ endedAt: new Date().toISOString() });

    expect(res.status).toBe(401);
  });

  it('returns 404 when session does not exist', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({ endedAt: new Date().toISOString() });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Session not found' });
  });

  it('returns 404 when session belongs to a different user', async () => {
    authenticateAs('attacker-user-id');

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: SESSION_ID, user_id: VALID_USER_ID }, // owned by someone else
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({ endedAt: new Date().toISOString() });

    expect(res.status).toBe(404);
  });

  it('returns 400 when no updatable fields are provided', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: SESSION_ID, user_id: VALID_USER_ID },
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'No updatable fields provided' });
  });

  it('returns 200 { ok: true } when endedAt is provided', async () => {
    authenticateAs();

    const endedAt = new Date().toISOString();

    // First call to from() is the select for ownership check
    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: SESSION_ID, user_id: VALID_USER_ID },
        error: null,
      }),
    };

    // Second call to from() is the update
    const mockUpdateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    };

    mockFrom.mockReturnValueOnce(mockSelectChain).mockReturnValueOnce(mockUpdateChain);

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({ endedAt });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Any change bumps updated_at, so assert the provided field is present rather
    // than an exact payload match.
    expect(mockUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ ended_at: endedAt }),
    );
    const updateArg = mockUpdateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updateArg['updated_at']).toBe('string');
  });

  it('returns 400 when status is not active or completed', async () => {
    authenticateAs();
    // Status validation runs before any DB call, so no mockFrom beyond auth.

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({ status: 'archived' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it('persists resumeOffset + status and bumps updated_at', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: SESSION_ID, user_id: VALID_USER_ID },
        error: null,
      }),
    };
    const mockUpdateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    };
    mockFrom.mockReturnValueOnce(mockSelectChain).mockReturnValueOnce(mockUpdateChain);

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({ resumeOffset: 12, status: 'completed' });

    expect(res.status).toBe(200);
    const updateArg = mockUpdateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({ resume_offset: 12, status: 'completed' });
    expect(typeof updateArg['updated_at']).toBe('string');
  });

  it('returns 500 when fetch fails with a database error', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: new Error('Connection timeout'),
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({ endedAt: new Date().toISOString() });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to fetch session' });
  });

  it('returns 500 when the update query fails', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: SESSION_ID, user_id: VALID_USER_ID },
        error: null,
      }),
    };

    const mockUpdateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: new Error('Update failed') }),
    };

    mockFrom.mockReturnValueOnce(mockSelectChain).mockReturnValueOnce(mockUpdateChain);

    const app = buildApp();
    const res = await request(app)
      .patch(`/sessions/${SESSION_ID}`)
      .set('Authorization', VALID_TOKEN)
      .send({ endedAt: new Date().toISOString() });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to update session' });
  });
});

// ---------------------------------------------------------------------------
// GET /sessions (list)
// ---------------------------------------------------------------------------
describe('GET /sessions', () => {
  // sessions list query chain: select → eq → order → limit (limit is terminal).
  function sessionsListChain(resolved: { data: unknown; error: unknown }) {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(resolved),
    };
  }

  // swipes / destinations / tracks query chain: select → in (in is terminal).
  function inChain(resolved: { data: unknown; error: unknown }) {
    return {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue(resolved),
    };
  }

  const SESSION_ROW = {
    id: SESSION_ID,
    source_playlist_id: PLAYLIST_ID,
    source_playlist_name: 'My Playlist',
    destination_playlist_ids: ['dest-1'],
    destination_playlist_names: ['Dest One'],
    is_filter_mode: false,
    resume_offset: 5,
    total_tracks: 20,
    status: 'active',
    started_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };

  it('returns 401 when no auth token is provided', async () => {
    unauthenticated();

    const app = buildApp();
    const res = await request(app).get('/sessions');

    expect(res.status).toBe(401);
  });

  it('returns an empty list when the user has no sessions', async () => {
    authenticateAs();

    mockFrom.mockReturnValueOnce(sessionsListChain({ data: [], error: null }));

    const app = buildApp();
    const res = await request(app).get('/sessions').set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: [] });
  });

  it('returns 500 when the sessions fetch fails', async () => {
    authenticateAs();

    mockFrom.mockReturnValueOnce(sessionsListChain({ data: null, error: new Error('DB error') }));

    const app = buildApp();
    const res = await request(app).get('/sessions').set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to fetch sessions/);
  });

  it('returns sessions with live counts and hydrated liked swipes', async () => {
    authenticateAs();

    // 1: sessions list
    const sessionsChain = sessionsListChain({ data: [SESSION_ROW], error: null });
    // 2: all swipes for the session — 1 liked, 1 super_liked, 1 skipped, 1 pending
    const swipesChain = inChain({
      data: [
        {
          id: 'sw-1',
          session_id: SESSION_ID,
          spotify_track_id: 'tr-1',
          status: 'liked',
          swiped_at: '2026-01-01T00:00:01Z',
        },
        {
          id: 'sw-2',
          session_id: SESSION_ID,
          spotify_track_id: 'tr-2',
          status: 'super_liked',
          swiped_at: '2026-01-01T00:00:02Z',
        },
        {
          id: 'sw-3',
          session_id: SESSION_ID,
          spotify_track_id: 'tr-3',
          status: 'skipped',
          swiped_at: '2026-01-01T00:00:03Z',
        },
        {
          id: 'sw-4',
          session_id: SESSION_ID,
          spotify_track_id: 'tr-4',
          status: 'pending',
          swiped_at: '2026-01-01T00:00:04Z',
        },
      ],
      error: null,
    });
    // 3: destinations for liked swipes
    const destChain = inChain({
      data: [{ swipe_id: 'sw-1', spotify_playlist_id: 'dest-1' }],
      error: null,
    });
    // 4: tracks — only tr-1 is cached; tr-2 must come back as track: null
    const tracksChain = inChain({
      data: [
        {
          spotify_track_id: 'tr-1',
          title: 'Song One',
          artist: 'Artist One',
          artists: ['Artist One'],
          album: null,
          album_art_url: null,
          duration_ms: null,
          preview_url: null,
          uri: 'spotify:track:tr-1',
        },
      ],
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(sessionsChain)
      .mockReturnValueOnce(swipesChain)
      .mockReturnValueOnce(destChain)
      .mockReturnValueOnce(tracksChain);

    const app = buildApp();
    const res = await request(app).get('/sessions').set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);

    const session = res.body.sessions[0];
    expect(session).toMatchObject({
      sessionId: SESSION_ID,
      sourcePlaylistId: PLAYLIST_ID,
      sourcePlaylistName: 'My Playlist',
      destinationPlaylistIds: ['dest-1'],
      isFilterMode: false,
      resumeOffset: 5,
      totalTracks: 20,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      // Decided only; pending excluded.
      swipedCount: 3,
      likedCount: 1,
      superLikedCount: 1,
    });

    // Liked + super_liked only, ordered oldest-first.
    expect(session.likedSwipes).toHaveLength(2);
    expect(session.likedSwipes[0]).toMatchObject({
      id: 'sw-1',
      spotifyTrackId: 'tr-1',
      status: 'liked',
      destinationPlaylistIds: ['dest-1'],
    });
    expect(session.likedSwipes[0].track).toMatchObject({ id: 'tr-1', title: 'Song One' });
    expect(session.likedSwipes[1].track).toBeNull();
  });

  it('skips destination/track queries when a session has no liked swipes', async () => {
    authenticateAs();

    const sessionsChain = sessionsListChain({ data: [SESSION_ROW], error: null });
    // Only skipped/pending swipes — no liked subset, so no dest/track queries run.
    const swipesChain = inChain({
      data: [
        {
          id: 'sw-3',
          session_id: SESSION_ID,
          spotify_track_id: 'tr-3',
          status: 'skipped',
          swiped_at: '2026-01-01T00:00:03Z',
        },
      ],
      error: null,
    });

    // No dest/track mocks queued: if the route queried them, from() would return
    // undefined and the request would 500. A 200 proves they were skipped.
    mockFrom.mockReturnValueOnce(sessionsChain).mockReturnValueOnce(swipesChain);

    const app = buildApp();
    const res = await request(app).get('/sessions').set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.sessions[0].swipedCount).toBe(1);
    expect(res.body.sessions[0].likedSwipes).toEqual([]);
  });
});
