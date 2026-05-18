import { SpotifyAdapter } from '../SpotifyAdapter';
import { PlatformError, PlatformErrorCode } from '../../interface';
import { spotifyFetch } from '../spotifyFetch';

jest.mock('../spotifyFetch');

const mockSpotifyFetch = spotifyFetch as jest.MockedFunction<typeof spotifyFetch>;

const makeAuth = () => ({
  accessToken: 'test-token',
  refreshToken: 'test-refresh',
  expiresAt: Date.now() + 60 * 60 * 1000,
  onTokenRefreshed: jest.fn(),
  onAuthExpired: jest.fn(),
});

describe('SpotifyAdapter — playback', () => {
  let adapter: SpotifyAdapter;

  beforeEach(() => {
    jest.resetAllMocks();
    adapter = new SpotifyAdapter(makeAuth());
  });

  // (a) play() fetches the active device then sends PUT /me/player/play
  it('calls GET /me/player/devices then PUT /me/player/play', async () => {
    mockSpotifyFetch
      // First call: GET /me/player/devices
      .mockResolvedValueOnce({
        devices: [{ id: 'device-1', is_active: true, name: 'My Speaker', type: 'Speaker' }],
      })
      // Second call: PUT /me/player/play
      .mockResolvedValueOnce({});

    await adapter.play('spotify:track:abc123');

    expect(mockSpotifyFetch).toHaveBeenCalledTimes(2);

    // First call must be the devices endpoint (GET by default — no method override)
    const [devicesEndpoint, devicesOptions] = mockSpotifyFetch.mock.calls[0];
    expect(devicesEndpoint).toBe('/me/player/devices');
    expect(devicesOptions).toEqual({});

    // Second call must PUT to the play endpoint with the correct device_id and URI
    const [playEndpoint, playOptions] = mockSpotifyFetch.mock.calls[1];
    expect(playEndpoint).toBe('/me/player/play?device_id=device-1');
    expect(playOptions.method).toBe('PUT');
    expect(JSON.parse(playOptions.body as string)).toEqual({ uris: ['spotify:track:abc123'] });
  });

  // (b) play() throws NO_ACTIVE_DEVICE when the devices array is empty
  it('throws NO_ACTIVE_DEVICE when devices array is empty', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({ devices: [] });

    await expect(adapter.play('spotify:track:abc123')).rejects.toMatchObject({
      code: PlatformErrorCode.NO_ACTIVE_DEVICE,
    });
  });

  // (c) cachedDeviceId is cleared when play() receives a NOT_FOUND error from Spotify
  it('clears cachedDeviceId on NOT_FOUND during play and re-throws as NO_ACTIVE_DEVICE', async () => {
    mockSpotifyFetch
      // First call: GET /me/player/devices — succeeds, caches device-1
      .mockResolvedValueOnce({
        devices: [{ id: 'device-1', is_active: true, name: 'My Speaker', type: 'Speaker' }],
      })
      // Second call: PUT /me/player/play — device has gone away
      .mockRejectedValueOnce(new PlatformError(PlatformErrorCode.NOT_FOUND));

    await expect(adapter.play('spotify:track:abc123')).rejects.toMatchObject({
      code: PlatformErrorCode.NO_ACTIVE_DEVICE,
    });

    // After the cache is cleared, a second play() call must fetch devices again
    mockSpotifyFetch
      .mockResolvedValueOnce({
        devices: [{ id: 'device-2', is_active: true, name: 'New Device', type: 'Computer' }],
      })
      .mockResolvedValueOnce({});

    await adapter.play('spotify:track:xyz');

    // Calls so far: devices(1) + play-fail(2) + devices(3) + play-ok(4)
    expect(mockSpotifyFetch).toHaveBeenCalledTimes(4);
    const [thirdCallEndpoint] = mockSpotifyFetch.mock.calls[2];
    expect(thirdCallEndpoint).toBe('/me/player/devices');
  });

  // (d) pause() calls PUT /me/player/pause
  it('calls PUT /me/player/pause', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.pause();

    expect(mockSpotifyFetch).toHaveBeenCalledTimes(1);
    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/player/pause');
    expect(options.method).toBe('PUT');
  });

  // (e) seek(30000) calls PUT /me/player/seek with position_ms=30000
  it('calls PUT /me/player/seek with position_ms=30000', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.seek(30000);

    expect(mockSpotifyFetch).toHaveBeenCalledTimes(1);
    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/player/seek?position_ms=30000');
    expect(options.method).toBe('PUT');
  });
});
