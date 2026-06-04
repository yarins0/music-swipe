import { BackendSync, SwipePayload } from '../BackendSync';

const BASE_URL = 'https://api.example.com';
const TOKEN = 'test-token';

function makePayload(overrides: Partial<SwipePayload> = {}): SwipePayload {
  return {
    sessionId: 'session-1',
    trackId: 'track-1',
    direction: 'liked',
    destinationPlaylistIds: ['dest-1'],
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown = {}): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

function mockFetchNetworkError(message = 'network error'): jest.Mock {
  return jest.fn().mockRejectedValue(new Error(message));
}

describe('BackendSync', () => {
  let sync: BackendSync;

  beforeEach(() => {
    sync = new BackendSync(BASE_URL, () => TOKEN);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // postSwipe
  // ---------------------------------------------------------------------------

  describe('postSwipe()', () => {
    it('is fire-and-forget — returns undefined synchronously', () => {
      global.fetch = mockFetch(200, { inserted: 1, updated: 0 });

      const result = sync.postSwipe(makePayload());

      expect(result).toBeUndefined();
    });

    it('POSTs to /swipes as a single-element array with correct shape', async () => {
      const fetchMock = mockFetch(200, { inserted: 1, updated: 0 });
      global.fetch = fetchMock;

      const payload = makePayload({ sessionId: 'session-42', trackId: 'track-99', direction: 'skipped' });
      sync.postSwipe(payload);

      // Flush microtasks
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/swipes`);
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      });

      const body = JSON.parse(init.body as string) as { swipes: unknown[] };
      expect(body.swipes).toHaveLength(1);
      expect(body.swipes[0]).toMatchObject({
        sessionId: 'session-42',
        spotifyTrackId: 'track-99',
        status: 'skipped',
        destinationPlaylistIds: ['dest-1'],
      });
    });

    it('does not throw when the server returns an error', async () => {
      global.fetch = mockFetch(500, { error: 'fail' });

      expect(() => sync.postSwipe(makePayload())).not.toThrow();

      // Flush so the caught rejection is processed
      await Promise.resolve();
    });

    it('does not throw when fetch rejects with a network error', async () => {
      global.fetch = mockFetchNetworkError();

      expect(() => sync.postSwipe(makePayload())).not.toThrow();

      await Promise.resolve();
    });
  });

  // ---------------------------------------------------------------------------
  // flushPending
  // ---------------------------------------------------------------------------

  describe('flushPending()', () => {
    it('is a no-op (resolves immediately) when the queue is empty', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      await sync.flushPending();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends all pending payloads as a batch and clears the queue', async () => {
      const fetchMock = mockFetch(200, { inserted: 2, updated: 0 });
      global.fetch = fetchMock;

      const p1 = makePayload({ trackId: 'track-1' });
      const p2 = makePayload({ trackId: 'track-2', direction: 'skipped' });

      // Use a fetch mock that never resolves for postSwipe fire-and-forget calls
      // so we can test flushPending separately. Reset fetch after postSwipe enqueues.
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {})); // never resolves
      sync.postSwipe(p1);
      sync.postSwipe(p2);

      // Now set the real mock for flushPending
      global.fetch = fetchMock;

      await sync.flushPending();

      // flushPending should have sent one batch call
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: unknown[] };
      expect(body.swipes).toHaveLength(2);
    });

    it('throws when the server returns a non-2xx response', async () => {
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
      sync.postSwipe(makePayload());

      global.fetch = mockFetch(503, { error: 'Service Unavailable' });

      await expect(sync.flushPending()).rejects.toThrow('BackendSync.sendBatch failed: 503');
    });

    it('throws when fetch rejects with a network error', async () => {
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
      sync.postSwipe(makePayload());

      global.fetch = mockFetchNetworkError('timeout');

      await expect(sync.flushPending()).rejects.toThrow('timeout');
    });

    it('clears the queue even if the batch request fails', async () => {
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
      sync.postSwipe(makePayload());

      global.fetch = mockFetch(500, { error: 'fail' });

      // Swallow the expected rejection
      await sync.flushPending().catch(() => {});

      // Queue must now be empty so a second flush is a no-op
      const fetchMock2 = jest.fn();
      global.fetch = fetchMock2;

      await sync.flushPending();
      expect(fetchMock2).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // M1 regression: successful postSwipe must NOT be re-sent by flushPending
    // -------------------------------------------------------------------------

    it('does not re-send a successfully posted swipe on flushPending', async () => {
      // postSwipe fires and resolves — the payload is removed from pending.
      global.fetch = mockFetch(200, { inserted: 1, updated: 0 });
      sync.postSwipe(makePayload({ trackId: 'track-ok' }));

      // Drain microtasks so the .then() cleanup runs and removes the payload.
      await Promise.resolve();
      await Promise.resolve();

      // flushPending must be a no-op: nothing left in the queue.
      const flushMock = jest.fn();
      global.fetch = flushMock;
      await sync.flushPending();

      expect(flushMock).not.toHaveBeenCalled();
    });

    it('retries a failed postSwipe when flushPending is called', async () => {
      // postSwipe fires and rejects — the payload stays in pending.
      global.fetch = mockFetch(500, { error: 'server error' });
      sync.postSwipe(makePayload({ trackId: 'track-fail' }));

      // Drain microtasks so the .catch() runs (payload stays in pending).
      await Promise.resolve();
      await Promise.resolve();

      // flushPending must send the still-pending payload.
      const retryMock = mockFetch(200, { inserted: 1, updated: 0 });
      global.fetch = retryMock;
      await sync.flushPending();

      expect(retryMock).toHaveBeenCalledTimes(1);
      const [, init] = retryMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: unknown[] };
      expect(body.swipes).toHaveLength(1);
      expect(body.swipes[0]).toMatchObject({ spotifyTrackId: 'track-fail' });
    });
  });
});
