import { spotifyFetch, SpotifyAuthContext } from '../spotifyFetch';
import { PlatformError, PlatformErrorCode } from '../../interface';

// These literals are Spotify-specific but live inside src/adapters/spotify/ — allowed by the
// adapter boundary rule. They mirror the endpoints spotifyFetch.ts talks to.
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const PROACTIVE_BUFFER_MS = 5 * 60 * 1000;

interface FakeResponseOptions {
  status?: number;
  jsonBody?: unknown;
  textBody?: string;
  headers?: Record<string, string>;
}

// Minimal stand-in for the Fetch API Response surface that spotifyFetch actually reads.
function makeResponse(options: FakeResponseOptions = {}): Response {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => options.headers?.[key.toLowerCase()] ?? null },
    json: async () => options.jsonBody,
    text: async () => options.textBody ?? (options.jsonBody ? JSON.stringify(options.jsonBody) : ''),
  } as unknown as Response;
}

// Auth context whose token is already inside the proactive-refresh buffer, so every
// spotifyFetch call triggers a refresh before its request — the H1 concurrency scenario.
function makeExpiringAuth(): jest.Mocked<SpotifyAuthContext> {
  return {
    accessToken: 'old-token',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 1000, // < PROACTIVE_BUFFER_MS away → forces a refresh
    onTokenRefreshed: jest.fn().mockResolvedValue(undefined),
    onAuthExpired: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SpotifyAuthContext>;
}

const TOKEN_SUCCESS = { access_token: 'new-token', expires_in: 3600 };

function tokenEndpointCallCount(): number {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === TOKEN_ENDPOINT).length;
}

describe('spotifyFetch — token refresh (H1 single-flight, H2 selective auth-expiry)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('H1: a concurrent burst inside the proactive buffer triggers exactly one refresh', async () => {
    // Sanity that the buffer assumption holds for this auth fixture.
    const auth = makeExpiringAuth();
    expect(Date.now()).toBeGreaterThanOrEqual(auth.expiresAt - PROACTIVE_BUFFER_MS);

    global.fetch = jest.fn(async (url: string) => {
      if (url === TOKEN_ENDPOINT) return makeResponse({ status: 200, jsonBody: TOKEN_SUCCESS });
      return makeResponse({ status: 200, textBody: '{"ok":true}' });
    }) as unknown as typeof fetch;

    const results = await Promise.all([
      spotifyFetch('/me', {}, auth),
      spotifyFetch('/me/tracks', {}, auth),
      spotifyFetch('/me/player/devices', {}, auth),
    ]);

    expect(tokenEndpointCallCount()).toBe(1); // single-flight collapsed 3 refreshes into 1
    expect(auth.onAuthExpired).not.toHaveBeenCalled();
    expect(results).toHaveLength(3);
  });

  it('H1: a later refresh still works after the in-flight promise has cleared', async () => {
    const auth = makeExpiringAuth();
    global.fetch = jest.fn(async (url: string) => {
      if (url === TOKEN_ENDPOINT) return makeResponse({ status: 200, jsonBody: TOKEN_SUCCESS });
      return makeResponse({ status: 200, textBody: '{"ok":true}' });
    }) as unknown as typeof fetch;

    await spotifyFetch('/me', {}, auth);
    await spotifyFetch('/me', {}, auth);

    // Two sequential bursts → two independent refreshes (the guard cleared in between).
    expect(tokenEndpointCallCount()).toBe(2);
  });

  it('H2: a transient 5xx from the token endpoint throws NETWORK_ERROR without logging out', async () => {
    const auth = makeExpiringAuth();
    global.fetch = jest.fn(async (url: string) => {
      if (url === TOKEN_ENDPOINT) return makeResponse({ status: 500, textBody: 'upstream down' });
      return makeResponse({ status: 200, textBody: '{"ok":true}' });
    }) as unknown as typeof fetch;

    await expect(spotifyFetch('/me', {}, auth)).rejects.toMatchObject({
      code: PlatformErrorCode.NETWORK_ERROR,
    });
    expect(auth.onAuthExpired).not.toHaveBeenCalled();
  });

  it('H2: a network throw from the token endpoint throws NETWORK_ERROR without logging out', async () => {
    const auth = makeExpiringAuth();
    global.fetch = jest.fn(async (url: string) => {
      if (url === TOKEN_ENDPOINT) throw new TypeError('Network request failed');
      return makeResponse({ status: 200, textBody: '{"ok":true}' });
    }) as unknown as typeof fetch;

    await expect(spotifyFetch('/me', {}, auth)).rejects.toBeInstanceOf(PlatformError);
    await expect(spotifyFetch('/me', {}, auth)).rejects.toMatchObject({
      code: PlatformErrorCode.NETWORK_ERROR,
    });
    expect(auth.onAuthExpired).not.toHaveBeenCalled();
  });

  it('H2: a 400 invalid_grant calls onAuthExpired exactly once and throws AUTH_EXPIRED', async () => {
    const auth = makeExpiringAuth();
    global.fetch = jest.fn(async (url: string) => {
      if (url === TOKEN_ENDPOINT) return makeResponse({ status: 400, textBody: '{"error":"invalid_grant"}' });
      return makeResponse({ status: 200, textBody: '{"ok":true}' });
    }) as unknown as typeof fetch;

    await expect(spotifyFetch('/me', {}, auth)).rejects.toMatchObject({
      code: PlatformErrorCode.AUTH_EXPIRED,
    });
    expect(auth.onAuthExpired).toHaveBeenCalledTimes(1);
  });

  it('uses the refreshed token for the API request after a proactive refresh', async () => {
    const auth = makeExpiringAuth();
    global.fetch = jest.fn(async (url: string) => {
      if (url === TOKEN_ENDPOINT) return makeResponse({ status: 200, jsonBody: TOKEN_SUCCESS });
      return makeResponse({ status: 200, textBody: '{"ok":true}' });
    }) as unknown as typeof fetch;

    await spotifyFetch('/me', {}, auth);

    const apiCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => url.startsWith(API_BASE));
    expect(apiCall?.[1].headers.Authorization).toBe('Bearer new-token');
  });
});
