import express from 'express';
import request from 'supertest';

// Mock the db client before any module that imports it is loaded
jest.mock('../db/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

import sessionsRouter from '../routes/sessions';
import { supabase } from '../db/client';

// Typed mock helpers
const mockGetUser = supabase.auth.getUser as jest.Mock;
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

// Helper: set up getUser to return a valid authenticated user
function authenticateAs(userId: string = VALID_USER_ID): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
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

  it('returns 200 with camelCase session stats for own session', async () => {
    authenticateAs();

    const mockSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: SESSION_ID,
          user_id: VALID_USER_ID,
          source_playlist_id: PLAYLIST_ID,
          started_at: '2026-01-01T10:00:00Z',
          ended_at: '2026-01-01T10:30:00Z',
          swiped_count: 20,
          liked_count: 12,
          super_liked_count: 3,
        },
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

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
      swipedCount: 20,
      likedCount: 12,
      superLikedCount: 3,
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

  it('returns 500 when the database fetch fails', async () => {
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
      .send({ swipedCount: 10 });

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
      .send({ swipedCount: 10 });

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

  it('returns 200 { ok: true } when update succeeds', async () => {
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
      .send({ endedAt, swipedCount: 15, likedCount: 8, superLikedCount: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockUpdateChain.update).toHaveBeenCalledWith({
      ended_at: endedAt,
      swiped_count: 15,
      liked_count: 8,
      super_liked_count: 2,
    });
  });

  it('returns 200 when only some fields are provided', async () => {
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
      .send({ likedCount: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Only liked_count should be in the update payload
    expect(mockUpdateChain.update).toHaveBeenCalledWith({ liked_count: 5 });
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
      .send({ swipedCount: 5 });

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
      .send({ swipedCount: 5 });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to update session' });
  });
});
