import express from 'express';
import request from 'supertest';

// Mock the db client before any module that imports it is loaded.
jest.mock('../db/client', () => ({
  supabase: {
    from: jest.fn(),
  },
  supabaseAuth: {
    auth: {
      signInWithPassword: jest.fn(),
      admin: {
        createUser: jest.fn(),
      },
    },
  },
}));

// The registration limiter has its own coverage in rateLimit.test.ts. Replacing it
// with a passthrough keeps the route tests independent of the 10-request window.
jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

import authRouter from '../routes/auth';
import { supabase, supabaseAuth } from '../db/client';

const mockSignIn = (
  supabaseAuth as unknown as { auth: { signInWithPassword: jest.Mock } }
).auth.signInWithPassword;
const mockCreateUser = (
  supabaseAuth as unknown as { auth: { admin: { createUser: jest.Mock } } }
).auth.admin.createUser;
const mockFrom = supabase.from as jest.Mock;

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

const SPOTIFY_USER_ID = 'spotify-user-abc';
const SUPABASE_USER_ID = 'supabase-uuid-123';
const ACCESS_TOKEN = 'supabase-access-token';
const SPOTIFY_TOKEN = 'spotify-access-token';

const SPOTIFY_ME_BODY = {
  id: SPOTIFY_USER_ID,
  display_name: 'Test User',
  email: 'test@example.com',
};

/** A successful Supabase sign-in result. */
function signInSuccess(): { data: { session: unknown }; error: null } {
  return {
    data: {
      session: {
        access_token: ACCESS_TOKEN,
        user: { id: SUPABASE_USER_ID },
      },
    },
    error: null,
  };
}

/** A failed Supabase sign-in result — no account exists yet, or the password is wrong. */
function signInFailure(): { data: { session: null }; error: Error } {
  return { data: { session: null }, error: new Error('Invalid login credentials') };
}

/** Makes the Spotify /me call answer with the given status and body. */
function mockSpotifyMe(status: number, body: unknown = SPOTIFY_ME_BODY): void {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

/** Makes the users upsert succeed. */
function mockUpsertSuccess(): jest.Mock {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  mockFrom.mockReturnValue({ upsert });
  return upsert;
}

let consoleErrorSpy: jest.SpyInstance;

beforeAll(() => {
  // deriveUserPassword runs HKDF over this value, so it must be present.
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('POST /auth/register — request validation', () => {
  it('rejects a body without spotifyAccessToken', async () => {
    const response = await request(buildApp()).post('/auth/register').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'spotifyAccessToken is required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a Spotify token Spotify itself refuses', async () => {
    mockSpotifyMe(401);

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid Spotify access token' });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('answers 502 when Spotify is unreachable', async () => {
    mockSpotifyMe(503, {});

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'Failed to verify Spotify token' });
  });
});

describe('POST /auth/register — returning user', () => {
  it('signs in and never calls createUser', async () => {
    mockSpotifyMe(200);
    mockSignIn.mockResolvedValue(signInSuccess());
    mockUpsertSuccess();

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      supabaseToken: ACCESS_TOKEN,
      userId: SUPABASE_USER_ID,
    });
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('upserts public.users on spotify_user_id', async () => {
    mockSpotifyMe(200);
    mockSignIn.mockResolvedValue(signInSuccess());
    const upsert = mockUpsertSuccess();

    await request(buildApp()).post('/auth/register').send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(upsert).toHaveBeenCalledWith(
      {
        supabase_id: SUPABASE_USER_ID,
        spotify_user_id: SPOTIFY_USER_ID,
        display_name: 'Test User',
        email: 'test@example.com',
      },
      { onConflict: 'spotify_user_id' },
    );
  });

  it('answers 500 when the users upsert fails', async () => {
    mockSpotifyMe(200);
    mockSignIn.mockResolvedValue(signInSuccess());
    mockFrom.mockReturnValue({ upsert: jest.fn().mockResolvedValue({ error: new Error('boom') }) });

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to create user record' });
  });
});

describe('POST /auth/register — first-time user', () => {
  it('creates the auth account, then signs in', async () => {
    mockSpotifyMe(200);
    mockSignIn.mockResolvedValueOnce(signInFailure()).mockResolvedValueOnce(signInSuccess());
    mockCreateUser.mockResolvedValue({ error: null });
    mockUpsertSuccess();

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body.supabaseToken).toBe(ACCESS_TOKEN);
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });
});

describe('POST /auth/register — concurrent registration race', () => {
  // Two first-time requests for the same Spotify user arrive together. Both fail the
  // first sign-in, both call createUser, and the loser gets "email already exists".
  // Its account is valid, so the retried sign-in must succeed and return a session.
  it('recovers when createUser loses the race but the retry sign-in succeeds', async () => {
    mockSpotifyMe(200);
    mockSignIn.mockResolvedValueOnce(signInFailure()).mockResolvedValueOnce(signInSuccess());
    mockCreateUser.mockResolvedValue({
      error: { message: 'A user with this email address has already been registered' },
    });
    mockUpsertSuccess();

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      supabaseToken: ACCESS_TOKEN,
      userId: SUPABASE_USER_ID,
    });
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });

  it('answers 500 when createUser fails and the retry sign-in also fails', async () => {
    mockSpotifyMe(200);
    mockSignIn.mockResolvedValue(signInFailure());
    mockCreateUser.mockResolvedValue({ error: { message: 'Database error creating new user' } });

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to create session' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('answers 500 when createUser succeeds but the retry sign-in returns no session', async () => {
    mockSpotifyMe(200);
    mockSignIn.mockResolvedValue(signInFailure());
    mockCreateUser.mockResolvedValue({ error: null });

    const response = await request(buildApp())
      .post('/auth/register')
      .send({ spotifyAccessToken: SPOTIFY_TOKEN });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to create session' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
