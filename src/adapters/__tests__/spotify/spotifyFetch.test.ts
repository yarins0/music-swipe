import { spotifyFetch } from '../../spotify/spotifyFetch';
import { PlatformErrorCode } from '../../interface';

const mockFetch = jest.fn();
// jest-expo's RN test environment exposes `global` as the React Native global object.
// Declare it here so the IDE resolves the name without requiring @types/node globally.
declare const global: Record<string, unknown>;
global.fetch = mockFetch;

const buildAuth = (overrides: Record<string, unknown> = {}) => ({
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 10 * 60 * 1000,
  onTokenRefreshed: jest.fn().mockResolvedValue(undefined),
  onAuthExpired: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const makeResponse = (status: number, body: unknown = {}) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID = 'test-client-id';
});

describe('spotifyFetch', () => {
  it('makes a successful request and returns parsed JSON', async () => {
    mockFetch.mockReturnValueOnce(makeResponse(200, { name: 'Test' }));
    const result = await spotifyFetch('/me', { method: 'GET' }, buildAuth());
    expect(result).toEqual({ name: 'Test' });
  });

  it('proactively refreshes when within the 5-minute buffer window', async () => {
    const auth = buildAuth({ expiresAt: Date.now() + 4 * 60 * 1000 });
    mockFetch
      .mockReturnValueOnce(makeResponse(200, { access_token: 'new-token', expires_in: 3600 }))
      .mockReturnValueOnce(makeResponse(200, { id: 'user-1' }));

    await spotifyFetch('/me', { method: 'GET' }, auth);

    expect(auth.onTokenRefreshed).toHaveBeenCalledWith('new-token', expect.any(Number));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT proactively refresh when outside the 5-minute buffer', async () => {
    const auth = buildAuth({ expiresAt: Date.now() + 10 * 60 * 1000 });
    mockFetch.mockReturnValueOnce(makeResponse(200, { id: 'user-1' }));

    await spotifyFetch('/me', { method: 'GET' }, auth);

    expect(auth.onTokenRefreshed).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on 401 with a refreshed token', async () => {
    const auth = buildAuth();
    mockFetch
      .mockReturnValueOnce(makeResponse(401))
      .mockReturnValueOnce(makeResponse(200, { access_token: 'refreshed', expires_in: 3600 }))
      .mockReturnValueOnce(makeResponse(200, { id: 'user-1' }));

    const result = await spotifyFetch('/me', { method: 'GET' }, auth);

    expect(result).toEqual({ id: 'user-1' });
    expect(auth.onTokenRefreshed).toHaveBeenCalledWith('refreshed', expect.any(Number));
  });

  it('calls onAuthExpired and throws AUTH_EXPIRED on double-401', async () => {
    const auth = buildAuth();
    mockFetch
      .mockReturnValueOnce(makeResponse(401))
      .mockReturnValueOnce(makeResponse(200, { access_token: 'refreshed', expires_in: 3600 }))
      .mockReturnValueOnce(makeResponse(401));

    await expect(spotifyFetch('/me', { method: 'GET' }, auth)).rejects.toMatchObject({
      code: PlatformErrorCode.AUTH_EXPIRED,
    });
    expect(auth.onAuthExpired).toHaveBeenCalled();
  });

  it('throws RATE_LIMITED on a 429 response', async () => {
    mockFetch.mockReturnValueOnce(makeResponse(429));

    await expect(spotifyFetch('/me', { method: 'GET' }, buildAuth())).rejects.toMatchObject({
      code: PlatformErrorCode.RATE_LIMITED,
    });
  });

  it('throws PERMISSION_DENIED on a 403 response', async () => {
    mockFetch.mockReturnValueOnce(makeResponse(403));

    await expect(spotifyFetch('/me', { method: 'GET' }, buildAuth())).rejects.toMatchObject({
      code: PlatformErrorCode.PERMISSION_DENIED,
    });
  });

  it('returns empty object on 204 No Content', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 204, json: jest.fn() } as unknown as Response),
    );

    const result = await spotifyFetch('/me/tracks', { method: 'PUT' }, buildAuth());
    expect(result).toEqual({});
  });
});
