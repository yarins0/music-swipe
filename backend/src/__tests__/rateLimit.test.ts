import express from 'express';
import request from 'supertest';

// Mock the db client before any module that imports it is loaded. Unauthenticated
// requests never reach Supabase (requireAuth rejects a missing token first), so
// these mocks are only here to satisfy the import graph.
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
import { createRateLimiter } from '../middleware/rateLimit';

// Mirrors the production wiring in index.ts: the global limiter runs before the
// routers, so it throttles every route — including the query-heavy GET /sessions.
function buildApp(max: number): express.Application {
  const app = express();
  app.use(express.json());
  app.use(createRateLimiter({ max, windowMs: 60_000 }));
  app.use('/sessions', sessionsRouter);
  return app;
}

describe('global rate limiting', () => {
  it('throttles /sessions once a client exceeds the request limit', async () => {
    const MAX = 3;
    const app = buildApp(MAX);

    // Requests under the cap fall through to requireAuth (401, no token). The
    // limiter keys on a normalised IP here since no userId is resolved yet, so
    // every supertest request shares one bucket.
    for (let attempt = 0; attempt < MAX; attempt += 1) {
      const res = await request(app).get('/sessions');
      expect(res.status).toBe(401);
    }

    const limited = await request(app).get('/sessions');
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'Too many requests, please try again later' });
  });

  it('allows requests once the count is below the cap for a fresh client', async () => {
    // A separate app (and therefore a fresh limiter store) is not yet at the cap,
    // so the first request is not throttled — confirming 429 is limit-driven, not
    // a blanket rejection.
    const app = buildApp(5);

    const res = await request(app).get('/sessions');
    expect(res.status).toBe(401);
  });
});
