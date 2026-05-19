import { PlaylistWriter } from '../PlaylistWriter';
import {
  MusicPlatformAdapter,
  PlatformError,
  PlatformErrorCode,
  AdapterCapabilities,
  Track,
  Playlist,
} from '../../adapters/interface';

// Minimal stub capabilities — all flags false
const stubCapabilities: AdapterCapabilities = {
  requiresExplicitFollow: false,
  supportsSeek: false,
  requiresPremium: false,
  supportsLibrarySave: true,
  supportsPlaylistCreation: false,
};

function buildMockAdapter(overrides: Partial<MusicPlatformAdapter> = {}): jest.Mocked<MusicPlatformAdapter> {
  const base: jest.Mocked<MusicPlatformAdapter> = {
    capabilities: stubCapabilities,
    isAuthenticated: jest.fn().mockResolvedValue(true),
    refreshAuth: jest.fn().mockResolvedValue(undefined),
    getUserId: jest.fn().mockResolvedValue('user-1'),
    getUserPlaylists: jest.fn().mockResolvedValue([]),
    getPlaylistById: jest.fn().mockResolvedValue({} as Playlist),
    getPlaylistTracks: jest.fn().mockResolvedValue({ tracks: [], total: 0 }),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    seek: jest.fn().mockResolvedValue(undefined),
    getCurrentTrack: jest.fn().mockResolvedValue(null as Track | null),
    getCurrentPositionMs: jest.fn().mockResolvedValue(0),
    addToPlaylist: jest.fn().mockResolvedValue(undefined),
    removeFromPlaylist: jest.fn().mockResolvedValue(undefined),
    saveToLibrary: jest.fn().mockResolvedValue(undefined),
    createPlaylist: jest.fn().mockResolvedValue('new-playlist-id'),
    openPlatformDeepLink: jest.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides } as jest.Mocked<MusicPlatformAdapter>;
}

describe('PlaylistWriter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('write()', () => {
    it('fires addToPlaylist for each destinationId in parallel', async () => {
      const adapter = buildMockAdapter();
      const writer = new PlaylistWriter(adapter);

      writer.write('track-1', ['playlist-a', 'playlist-b', 'playlist-c']);

      // Flush all microtasks + timers
      await jest.runAllTimersAsync();

      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(3);
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-a', 'track-1');
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-b', 'track-1');
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-c', 'track-1');
    });

    it('is fire-and-forget — write() returns void synchronously', () => {
      const adapter = buildMockAdapter();
      const writer = new PlaylistWriter(adapter);

      const result = writer.write('track-1', ['playlist-a']);

      // Must return undefined (void), not a Promise
      expect(result).toBeUndefined();
    });
  });

  describe('executeWithBackoff — retry on RATE_LIMITED', () => {
    it('retries on RATE_LIMITED and eventually succeeds', async () => {
      const rateLimitedError = new PlatformError(PlatformErrorCode.RATE_LIMITED, 'rate limited');
      const addToPlaylist = jest.fn()
        .mockRejectedValueOnce(rateLimitedError)
        .mockRejectedValueOnce(rateLimitedError)
        .mockResolvedValueOnce(undefined);

      const adapter = buildMockAdapter({ addToPlaylist });
      const writer = new PlaylistWriter(adapter);

      writer.write('track-1', ['playlist-a']);

      // Advance through the exponential backoff delays
      await jest.runAllTimersAsync();

      expect(addToPlaylist).toHaveBeenCalledTimes(3);
    });

    it('stops retrying after MAX_ATTEMPTS (5) on RATE_LIMITED and warns', async () => {
      const rateLimitedError = new PlatformError(PlatformErrorCode.RATE_LIMITED, 'rate limited');
      const addToPlaylist = jest.fn().mockRejectedValue(rateLimitedError);

      const adapter = buildMockAdapter({ addToPlaylist });
      const writer = new PlaylistWriter(adapter);

      writer.write('track-1', ['playlist-a']);

      await jest.runAllTimersAsync();

      // MAX_ATTEMPTS = 5
      expect(addToPlaylist).toHaveBeenCalledTimes(5);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[PlaylistWriter]'),
        expect.anything(),
      );
    });
  });

  describe('executeWithBackoff — non-retryable errors', () => {
    it('does NOT retry on non-RATE_LIMITED errors', async () => {
      const authError = new PlatformError(PlatformErrorCode.AUTH_EXPIRED, 'auth expired');
      const addToPlaylist = jest.fn().mockRejectedValue(authError);

      const adapter = buildMockAdapter({ addToPlaylist });
      const writer = new PlaylistWriter(adapter);

      writer.write('track-1', ['playlist-a']);

      await jest.runAllTimersAsync();

      // Only 1 call — no retries
      expect(addToPlaylist).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[PlaylistWriter]'),
        expect.anything(),
      );
    });

    it('does NOT retry on generic (non-PlatformError) errors', async () => {
      const genericError = new Error('network failure');
      const addToPlaylist = jest.fn().mockRejectedValue(genericError);

      const adapter = buildMockAdapter({ addToPlaylist });
      const writer = new PlaylistWriter(adapter);

      writer.write('track-1', ['playlist-a']);

      await jest.runAllTimersAsync();

      expect(addToPlaylist).toHaveBeenCalledTimes(1);
    });
  });

  describe('superLike()', () => {
    it('calls write() for all destinations and saveToLibrary fire-and-forget', async () => {
      const adapter = buildMockAdapter();
      const writer = new PlaylistWriter(adapter);

      writer.superLike('track-1', ['playlist-a', 'playlist-b']);

      await jest.runAllTimersAsync();

      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(2);
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-a', 'track-1');
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-b', 'track-1');
      expect(adapter.saveToLibrary).toHaveBeenCalledWith('track-1');
    });

    it('returns void synchronously (fire-and-forget)', () => {
      const adapter = buildMockAdapter();
      const writer = new PlaylistWriter(adapter);

      const result = writer.superLike('track-1', ['playlist-a']);

      expect(result).toBeUndefined();
    });

    it('warns but does not throw when saveToLibrary fails', async () => {
      const adapter = buildMockAdapter({
        saveToLibrary: jest.fn().mockRejectedValue(new Error('lib error')),
      });
      const writer = new PlaylistWriter(adapter);

      writer.superLike('track-1', ['playlist-a']);

      await jest.runAllTimersAsync();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[PlaylistWriter]'),
        expect.anything(),
      );
    });
  });
});
