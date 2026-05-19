import { SessionTracker } from '../SessionTracker';

const BASE_URL = 'https://api.example.com';
const TOKEN = 'test-token';

// Helper that builds a minimal fetch mock returning a JSON body.
function mockFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

// Helper that builds a fetch mock that rejects with a network error.
function mockFetchNetworkError(message = 'network error'): jest.Mock {
  return jest.fn().mockRejectedValue(new Error(message));
}

describe('SessionTracker', () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    tracker = new SessionTracker(BASE_URL, TOKEN);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // openSession
  // ---------------------------------------------------------------------------

  describe('openSession()', () => {
    it('POSTs to /sessions and returns the session id on success', async () => {
      const fetchMock = mockFetch(201, { id: 'session-abc' });
      global.fetch = fetchMock;

      const id = await tracker.openSession('playlist-1', ['dest-1']);

      expect(id).toBe('session-abc');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/sessions`);
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      });
      expect(JSON.parse(init.body as string)).toMatchObject({
        sourcePlaylistId: 'playlist-1',
      });
    });

    it('works when destinationPlaylistIds is omitted (defaults to [])', async () => {
      global.fetch = mockFetch(201, { id: 'session-xyz' });

      const id = await tracker.openSession('playlist-1');

      expect(id).toBe('session-xyz');
    });

    it('throws when the server returns a non-2xx status', async () => {
      global.fetch = mockFetch(500, { error: 'Internal Server Error' });

      await expect(tracker.openSession('playlist-1', [])).rejects.toThrow('openSession failed: 500');
    });

    it('throws when fetch rejects (network error)', async () => {
      global.fetch = mockFetchNetworkError('connection refused');

      await expect(tracker.openSession('playlist-1', [])).rejects.toThrow('connection refused');
    });
  });

  // ---------------------------------------------------------------------------
  // closeSession
  // ---------------------------------------------------------------------------

  describe('closeSession()', () => {
    it('is fire-and-forget — returns undefined synchronously', () => {
      global.fetch = mockFetch(200, { ok: true });

      const result = tracker.closeSession('session-1');

      expect(result).toBeUndefined();
    });

    it('PATCHes /sessions/:id with endedAt', async () => {
      const fetchMock = mockFetch(200, { ok: true });
      global.fetch = fetchMock;

      tracker.closeSession('session-1');

      // Flush microtasks so the fire-and-forget fetch call is made
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/sessions/session-1`);
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(typeof body['endedAt']).toBe('string');
    });

    it('does not throw when the server returns an error', async () => {
      global.fetch = mockFetch(500, { error: 'fail' });

      // Must not throw — just a fire-and-forget warning
      expect(() => tracker.closeSession('session-1')).not.toThrow();
    });

    it('does not throw when fetch rejects with a network error', async () => {
      global.fetch = mockFetchNetworkError();

      expect(() => tracker.closeSession('session-1')).not.toThrow();

      // Flush so the rejected promise is handled (prevents unhandled rejection noise)
      await Promise.resolve();
    });
  });

  // ---------------------------------------------------------------------------
  // incrementCounts
  // ---------------------------------------------------------------------------

  describe('incrementCounts()', () => {
    it('is fire-and-forget — returns undefined synchronously', () => {
      global.fetch = mockFetch(200, { ok: true });

      const result = tracker.incrementCounts('session-1', { liked: 1 });

      expect(result).toBeUndefined();
    });

    it('sends only non-zero delta fields', async () => {
      const fetchMock = mockFetch(200, { ok: true });
      global.fetch = fetchMock;

      tracker.incrementCounts('session-1', { liked: 2, skipped: 0, superLiked: 1 });

      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;

      // liked and superLiked should be present; skipped (0) should not
      expect(body).toHaveProperty('likedCount', 2);
      expect(body).toHaveProperty('superLikedCount', 1);
      expect(body).not.toHaveProperty('swipedCount');
    });

    it('does not call fetch when all delta values are 0 or omitted', () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      tracker.incrementCounts('session-1', { liked: 0, skipped: 0, superLiked: 0 });
      tracker.incrementCounts('session-2', {});

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not throw when the server returns an error', async () => {
      global.fetch = mockFetch(500, { error: 'fail' });

      expect(() => tracker.incrementCounts('session-1', { liked: 1 })).not.toThrow();

      await Promise.resolve();
    });
  });
});
