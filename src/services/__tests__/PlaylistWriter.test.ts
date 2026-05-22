import { PlaylistWriter, PendingWrite, StorageInterface } from '../PlaylistWriter';
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

// In-memory StorageInterface stub — mimics AsyncStorage without native modules.
function buildMockStorage(initial: Record<string, string> = {}): jest.Mocked<StorageInterface> {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
  };
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
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

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
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      const result = writer.write('track-1', ['playlist-a']);

      // Must return undefined (void), not a Promise
      expect(result).toBeUndefined();
    });

    it('persists write entry to storage before calling addToPlaylist', async () => {
      // Track call order across storage.setItem and adapter.addToPlaylist.
      const callOrder: string[] = [];

      const addToPlaylist = jest.fn(async () => {
        callOrder.push('addToPlaylist');
      });
      const adapter = buildMockAdapter({ addToPlaylist });

      const store: Record<string, string> = {};
      const storage: jest.Mocked<StorageInterface> = {
        getItem: jest.fn(async (key: string) => store[key] ?? null),
        setItem: jest.fn(async (key: string, value: string) => {
          callOrder.push('setItem');
          store[key] = value;
        }),
        removeItem: jest.fn(async (key: string) => { delete store[key]; }),
      };

      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      // setItem (persisting to queue) must have been called before addToPlaylist.
      const firstSetItem = callOrder.indexOf('setItem');
      const firstAdd = callOrder.indexOf('addToPlaylist');
      expect(firstSetItem).toBeGreaterThanOrEqual(0);
      expect(firstAdd).toBeGreaterThanOrEqual(0);
      expect(firstSetItem).toBeLessThan(firstAdd);
    });

    it('removes entry from storage after a successful write', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      const raw = await storage.getItem('@music-swipe/playlist-write-queue');
      // Either null/missing, or an empty array — both indicate the entry was removed.
      const queue: PendingWrite[] = raw ? (JSON.parse(raw) as PendingWrite[]) : [];
      const entry = queue.find((e) => e.trackId === 'track-1' && e.playlistId === 'playlist-a');
      expect(entry).toBeUndefined();
    });

    it('keeps entry in storage after exhausting all RATE_LIMITED retries', async () => {
      const rateLimitedError = new PlatformError(PlatformErrorCode.RATE_LIMITED, 'rate limited');
      const addToPlaylist = jest.fn().mockRejectedValue(rateLimitedError);
      const adapter = buildMockAdapter({ addToPlaylist });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      const raw = await storage.getItem('@music-swipe/playlist-write-queue');
      expect(raw).not.toBeNull();
      const queue = JSON.parse(raw!) as PendingWrite[];
      const entry = queue.find((e) => e.trackId === 'track-1' && e.playlistId === 'playlist-a');
      expect(entry).toBeDefined();
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
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', ['playlist-a']);

      // Advance through the exponential backoff delays
      await jest.runAllTimersAsync();

      expect(addToPlaylist).toHaveBeenCalledTimes(3);
    });

    it('stops retrying after MAX_ATTEMPTS (5) on RATE_LIMITED and warns', async () => {
      const rateLimitedError = new PlatformError(PlatformErrorCode.RATE_LIMITED, 'rate limited');
      const addToPlaylist = jest.fn().mockRejectedValue(rateLimitedError);

      const adapter = buildMockAdapter({ addToPlaylist });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

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
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

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
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', ['playlist-a']);

      await jest.runAllTimersAsync();

      expect(addToPlaylist).toHaveBeenCalledTimes(1);
    });
  });

  describe('superLike()', () => {
    it('calls write() for all destinations and saveToLibrary fire-and-forget', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', ['playlist-a', 'playlist-b']);

      await jest.runAllTimersAsync();

      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(2);
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-a', 'track-1');
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-b', 'track-1');
      expect(adapter.saveToLibrary).toHaveBeenCalledWith('track-1');
    });

    it('returns void synchronously (fire-and-forget)', () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      const result = writer.superLike('track-1', ['playlist-a']);

      expect(result).toBeUndefined();
    });

    it('warns but does not throw when saveToLibrary fails', async () => {
      const adapter = buildMockAdapter({
        saveToLibrary: jest.fn().mockRejectedValue(new Error('lib error')),
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', ['playlist-a']);

      await jest.runAllTimersAsync();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[PlaylistWriter]'),
        expect.anything(),
      );
    });
  });

  describe('drainStoredQueue()', () => {
    it('retries stored entries and removes them on success', async () => {
      const storedQueue: PendingWrite[] = [
        { trackId: 'track-x', playlistId: 'playlist-q', attempts: 2 },
        { trackId: 'track-y', playlistId: 'playlist-r', attempts: 0 },
      ];
      const storage = buildMockStorage({
        '@music-swipe/playlist-write-queue': JSON.stringify(storedQueue),
      });
      const adapter = buildMockAdapter();

      await PlaylistWriter.drainStoredQueue(adapter, storage);

      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(2);
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-q', 'track-x');
      expect(adapter.addToPlaylist).toHaveBeenCalledWith('playlist-r', 'track-y');

      // Queue should be fully cleared after all entries succeed.
      expect(storage.removeItem).toHaveBeenCalledWith('@music-swipe/playlist-write-queue');
    });

    it('retries RATE_LIMITED entries and removes them when they eventually succeed', async () => {
      const rateLimitedError = new PlatformError(PlatformErrorCode.RATE_LIMITED, 'rate limited');
      const addToPlaylist = jest.fn()
        .mockRejectedValueOnce(rateLimitedError)
        .mockResolvedValueOnce(undefined);

      const storedQueue: PendingWrite[] = [
        { trackId: 'track-z', playlistId: 'playlist-s', attempts: 0 },
      ];
      const storage = buildMockStorage({
        '@music-swipe/playlist-write-queue': JSON.stringify(storedQueue),
      });
      const adapter = buildMockAdapter({ addToPlaylist });

      const drainPromise = PlaylistWriter.drainStoredQueue(adapter, storage);
      await jest.runAllTimersAsync();
      await drainPromise;

      expect(addToPlaylist).toHaveBeenCalledTimes(2);
      expect(storage.removeItem).toHaveBeenCalledWith('@music-swipe/playlist-write-queue');
    });

    it('keeps entries in storage when they cannot be retried successfully', async () => {
      const rateLimitedError = new PlatformError(PlatformErrorCode.RATE_LIMITED, 'rate limited');
      const addToPlaylist = jest.fn().mockRejectedValue(rateLimitedError);

      const storedQueue: PendingWrite[] = [
        { trackId: 'track-w', playlistId: 'playlist-t', attempts: 4 },
      ];
      const storage = buildMockStorage({
        '@music-swipe/playlist-write-queue': JSON.stringify(storedQueue),
      });
      const adapter = buildMockAdapter({ addToPlaylist });

      const drainPromise = PlaylistWriter.drainStoredQueue(adapter, storage);
      await jest.runAllTimersAsync();
      await drainPromise;

      // Entry exhausts MAX_ATTEMPTS — must remain in storage.
      expect(storage.setItem).toHaveBeenCalledWith(
        '@music-swipe/playlist-write-queue',
        expect.stringContaining('track-w'),
      );
      expect(storage.removeItem).not.toHaveBeenCalledWith('@music-swipe/playlist-write-queue');
    });

    it('does nothing when the queue is empty', async () => {
      const storage = buildMockStorage({
        '@music-swipe/playlist-write-queue': JSON.stringify([]),
      });
      const adapter = buildMockAdapter();

      await PlaylistWriter.drainStoredQueue(adapter, storage);

      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
    });

    it('does nothing when no queue key exists in storage', async () => {
      const storage = buildMockStorage();
      const adapter = buildMockAdapter();

      await PlaylistWriter.drainStoredQueue(adapter, storage);

      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
    });
  });
});
