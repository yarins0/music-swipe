import request from 'supertest';

// The db client reaches Supabase at import time. Mock it so importing the whole
// app (every router included) needs no credentials and no network.
jest.mock('../db/client', () => ({
  supabase: { from: jest.fn() },
  supabaseAuth: { auth: { getUser: jest.fn() } },
}));

import app from '../app';

describe('GET /health', () => {
  it('reports the process is live', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('answers without a bearer token, because Render polls it unauthenticated', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
  });

  it('is matched before the 404 handler', async () => {
    const unknown = await request(app).get('/health-not-a-route');

    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: 'Not found' });
  });
});
