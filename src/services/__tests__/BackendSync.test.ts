import { BackendSync, SwipePayload } from '../BackendSync';
import type { Track } from '@/adapters/interface';

const BASE_URL = 'https://api.example.com';
const TOKEN = 'test-token';

function makeTrack(id: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    title: `Track ${id}`,
    artist: 'Artist',
    artists: ['Artist', 'Featured'],
    album: 'Album',
    albumArtUrl: `https://example.com/art/${id}.jpg`,
    durationMs: 180000,
    previewUrl: null,
  };
}

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

    it('nests track metadata in the POST body when payload.track is present', async () => {
      const fetchMock = mockFetch(200, { inserted: 1, updated: 0 });
      global.fetch = fetchMock;

      sync.postSwipe(makePayload({ trackId: 'track-m', track: makeTrack('track-m') }));
      await Promise.resolve();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes[0]['track']).toEqual({
        uri: 'spotify:track:track-m',
        title: 'Track track-m',
        artist: 'Artist',
        artists: ['Artist', 'Featured'],
        album: 'Album',
        albumArtUrl: 'https://example.com/art/track-m.jpg',
        durationMs: 180000,
        previewUrl: null,
      });
    });

    it('omits the track key entirely when payload.track is undefined', async () => {
      const fetchMock = mockFetch(200, { inserted: 1, updated: 0 });
      global.fetch = fetchMock;

      sync.postSwipe(makePayload()); // no track
      await Promise.resolve();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes[0]).not.toHaveProperty('track');
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
  // unlikeSwipe
  // ---------------------------------------------------------------------------

  describe('unlikeSwipe()', () => {
    it('POSTs a skipped swipe with no destinations and no track metadata', async () => {
      const fetchMock = mockFetch(200, { inserted: 0, updated: 1 });
      global.fetch = fetchMock;

      sync.unlikeSwipe('session-7', 'track-cancel');
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/swipes`);
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes).toHaveLength(1);
      expect(body.swipes[0]).toMatchObject({
        sessionId: 'session-7',
        spotifyTrackId: 'track-cancel',
        status: 'skipped',
        destinationPlaylistIds: [],
      });
      expect(body.swipes[0]).not.toHaveProperty('track');
    });

    it('is fire-and-forget — returns undefined synchronously', () => {
      global.fetch = mockFetch(200, { inserted: 0, updated: 1 });

      expect(sync.unlikeSwipe('session-7', 'track-cancel')).toBeUndefined();
    });

    it('does not set the likedSongsWrittenByUs flag', async () => {
      const fetchMock = mockFetch(200, { inserted: 0, updated: 1 });
      global.fetch = fetchMock;

      sync.unlikeSwipe('session-7', 'track-cancel');
      await Promise.resolve();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes[0]).not.toHaveProperty('likedSongsWrittenByUs');
    });
  });

  // ---------------------------------------------------------------------------
  // markLibraryWritten
  // ---------------------------------------------------------------------------

  describe('markLibraryWritten()', () => {
    it('re-posts the swipe with likedSongsWrittenByUs=true and the original status/destinations', async () => {
      const fetchMock = mockFetch(200, { inserted: 0, updated: 1 });
      global.fetch = fetchMock;

      sync.markLibraryWritten({
        sessionId: 'session-9',
        trackId: 'track-lib',
        direction: 'super_liked',
        destinationPlaylistIds: ['dest-1', 'dest-2'],
      });
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/swipes`);
      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes[0]).toMatchObject({
        sessionId: 'session-9',
        spotifyTrackId: 'track-lib',
        status: 'super_liked',
        destinationPlaylistIds: ['dest-1', 'dest-2'],
        likedSongsWrittenByUs: true,
      });
    });

    it('is fire-and-forget — returns undefined synchronously', () => {
      global.fetch = mockFetch(200, { inserted: 0, updated: 1 });

      const result = sync.markLibraryWritten({
        sessionId: 'session-9',
        trackId: 'track-lib',
        direction: 'liked',
        destinationPlaylistIds: [],
      });
      expect(result).toBeUndefined();
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

    it('restores the batch to the queue when the request fails so it is retried', async () => {
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
      sync.postSwipe(makePayload({ trackId: 'track-retry' }));

      global.fetch = mockFetch(500, { error: 'fail' });

      // Swallow the expected rejection
      await sync.flushPending().catch(() => {});

      // The failed batch must remain queued — a second flush re-sends it.
      const retryMock = mockFetch(200, { inserted: 1, updated: 0 });
      global.fetch = retryMock;

      await sync.flushPending();

      expect(retryMock).toHaveBeenCalledTimes(1);
      const [, init] = retryMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes).toHaveLength(1);
      expect(body.swipes[0]).toMatchObject({ spotifyTrackId: 'track-retry' });
    });

    it('keeps the restored batch ahead of payloads enqueued after the failure', async () => {
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
      sync.postSwipe(makePayload({ trackId: 'older' }));

      global.fetch = mockFetch(500, { error: 'fail' });
      await sync.flushPending().catch(() => {});

      // A new swipe enqueues after the failed flush returned; keep it pending too.
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
      sync.postSwipe(makePayload({ trackId: 'newer' }));

      const retryMock = mockFetch(200, { inserted: 2, updated: 0 });
      global.fetch = retryMock;
      await sync.flushPending();

      const [, init] = retryMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes.map((s) => s['spotifyTrackId'])).toEqual(['older', 'newer']);
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
