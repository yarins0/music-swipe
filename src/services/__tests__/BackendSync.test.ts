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

/**
 * Enqueues a payload via postSwipe whose fire-and-forget send FAILS and then
 * settles, leaving the payload sitting in `pending` with its in-flight mark
 * cleared. This is the realistic precondition for flushPending tests: a payload
 * waiting to be flushed that is no longer mid-flight. (A never-resolving send is
 * not usable here — the L4 fix correctly keeps such a payload marked in-flight,
 * so flushPending would skip it.)
 */
async function enqueueFailedPostSwipe(sync: BackendSync, payload: SwipePayload): Promise<void> {
  global.fetch = mockFetch(500, { error: 'parked' });
  sync.postSwipe(payload);
  // Let the full sendBatch().catch().finally() chain drain so the payload stays
  // in `pending` and the in-flight mark is removed. A macrotask tick flushes all
  // queued microtasks regardless of how many hops the chain takes.
  await new Promise((resolve) => setTimeout(resolve, 0));
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
      // Park two payloads in `pending` via failed (then settled) postSwipe sends
      // so flushPending has a non-empty, non-in-flight queue to drain.
      await enqueueFailedPostSwipe(sync, makePayload({ trackId: 'track-1' }));
      await enqueueFailedPostSwipe(sync, makePayload({ trackId: 'track-2', direction: 'skipped' }));

      const fetchMock = mockFetch(200, { inserted: 2, updated: 0 });
      global.fetch = fetchMock;

      await sync.flushPending();

      // flushPending should have sent one batch call
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: unknown[] };
      expect(body.swipes).toHaveLength(2);
    });

    it('throws when the server returns a non-2xx response', async () => {
      await enqueueFailedPostSwipe(sync, makePayload());

      global.fetch = mockFetch(503, { error: 'Service Unavailable' });

      await expect(sync.flushPending()).rejects.toThrow('BackendSync.sendBatch failed: 503');
    });

    it('throws when fetch rejects with a network error', async () => {
      await enqueueFailedPostSwipe(sync, makePayload());

      global.fetch = mockFetchNetworkError('timeout');

      await expect(sync.flushPending()).rejects.toThrow('timeout');
    });

    it('restores the batch to the queue when the request fails so it is retried', async () => {
      await enqueueFailedPostSwipe(sync, makePayload({ trackId: 'track-retry' }));

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
      await enqueueFailedPostSwipe(sync, makePayload({ trackId: 'older' }));

      global.fetch = mockFetch(500, { error: 'fail' });
      await sync.flushPending().catch(() => {});

      // A new swipe enqueues after the failed flush returned; keep it pending too.
      await enqueueFailedPostSwipe(sync, makePayload({ trackId: 'newer' }));

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
      // postSwipe fires and rejects — the payload stays in pending. The .catch()
      // leaves it queued; the .finally() then clears its in-flight mark so a
      // later flush is free to retry it.
      await enqueueFailedPostSwipe(sync, makePayload({ trackId: 'track-fail' }));

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

    // -------------------------------------------------------------------------
    // L4 regression: flushPending must not re-send a payload whose postSwipe
    // request is still in flight (the M1 cleanup only runs once it resolves).
    // -------------------------------------------------------------------------

    it('does not re-send a payload whose postSwipe request is still in flight', async () => {
      // Defer the postSwipe request so it is still in flight when flushPending
      // runs. resolvePostSwipe lets us settle it on demand.
      let resolvePostSwipe: (value: { ok: boolean; status: number }) => void = () => {};
      const postSwipeResponse = { ok: true, status: 200 };
      const postSwipeFetch = jest.fn().mockReturnValue(
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolvePostSwipe = resolve;
        }),
      );
      global.fetch = postSwipeFetch;
      sync.postSwipe(makePayload({ trackId: 'track-inflight' }));

      // The postSwipe POST has been issued but not yet resolved.
      expect(postSwipeFetch).toHaveBeenCalledTimes(1);

      // flushPending while the payload is mid-flight: it must skip it, leaving
      // the in-flight request as the only send for this payload.
      const flushFetch = jest.fn();
      global.fetch = flushFetch;
      await sync.flushPending();

      expect(flushFetch).not.toHaveBeenCalled();

      // Settle the original in-flight request and let its cleanup run.
      resolvePostSwipe(postSwipeResponse);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('flushes the payload normally once its in-flight postSwipe send settles', async () => {
      // A failing postSwipe leaves the payload in pending. While its request is
      // in flight, flushPending must skip it; once it settles, flushPending
      // must be free to retry it.
      let rejectPostSwipe: (reason: Error) => void = () => {};
      const postSwipeFetch = jest.fn().mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectPostSwipe = reject;
        }),
      );
      global.fetch = postSwipeFetch;
      sync.postSwipe(makePayload({ trackId: 'track-settle' }));

      // Mid-flight flush is a no-op: the payload is still marked in flight.
      const skipFetch = jest.fn();
      global.fetch = skipFetch;
      await sync.flushPending();
      expect(skipFetch).not.toHaveBeenCalled();

      // Settle the in-flight send (failure keeps the payload in pending) and let
      // the whole .catch()/.finally() chain drain so the in-flight mark is
      // cleared. A macrotask tick flushes all queued microtasks regardless of
      // how many hops the promise chain takes.
      rejectPostSwipe(new Error('network down'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The payload is no longer blocked — flushPending now retries it.
      const retryFetch = mockFetch(200, { inserted: 1, updated: 0 });
      global.fetch = retryFetch;
      await sync.flushPending();

      expect(retryFetch).toHaveBeenCalledTimes(1);
      const [, init] = retryFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { swipes: Record<string, unknown>[] };
      expect(body.swipes).toHaveLength(1);
      expect(body.swipes[0]).toMatchObject({ spotifyTrackId: 'track-settle' });
    });
  });
});
