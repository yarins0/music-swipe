import { PlaylistWriter, PendingWrite, StorageInterface } from '../PlaylistWriter';
import {
  MusicPlatformAdapter,
  PlatformError,
  PlatformErrorCode,
  AdapterCapabilities,
  Track,
  Playlist,
  LIKED_SONGS_PLAYLIST_ID,
} from '../../adapters/interface';

// Minimal stub capabilities — all flags false
const stubCapabilities: AdapterCapabilities = {
  requiresExplicitFollow: false,
  supportsSeek: false,
  requiresPremium: false,
  supportsLibrarySave: true,
  supportsPlaylistCreation: false,
  canReadUnownedPlaylists: false,
};

function buildMockAdapter(overrides: Partial<MusicPlatformAdapter> = {}): jest.Mocked<MusicPlatformAdapter> {
  const base: jest.Mocked<MusicPlatformAdapter> = {
    capabilities: stubCapabilities,
    isAuthenticated: jest.fn().mockResolvedValue(true),
    refreshAuth: jest.fn().mockResolvedValue(undefined),
    getUserId: jest.fn().mockResolvedValue('user-1'),
    getUserProfile: jest.fn().mockResolvedValue({
      spotifyId: 'user-1',
      displayName: null,
      avatarUrl: null,
      email: null,
    }),
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
    removeFromLibrary: jest.fn().mockResolvedValue(undefined),
    isInLibrary: jest.fn().mockResolvedValue(false),
    createPlaylist: jest.fn().mockResolvedValue('new-playlist-id'),
    removeDuplicatesFromPlaylist: jest.fn().mockResolvedValue(0),
    openPlatformDeepLink: jest.fn().mockResolvedValue(undefined),
    openPlaylistInApp: jest.fn().mockResolvedValue(undefined),
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

    it('re-attempts addToPlaylist for the same pair on a repeat write (no cross-session dedup)', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      // First write — goes through
      writer.write('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();
      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(1);

      adapter.addToPlaylist.mockClear();

      // Second write of the same pair — must re-attempt. The cross-session dedup
      // skip was removed so a destination edited between sessions is corrected;
      // any resulting duplicates are cleaned by the optional post-session scan.
      writer.write('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();
      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(1);
    });

    it('re-attempts addToPlaylist on a write that follows an undoWrite', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();
      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(1);

      writer.undoWrite('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      adapter.addToPlaylist.mockClear();

      // Write again after undo — goes through.
      writer.write('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();
      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(1);
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
      expect(adapter.isInLibrary).toHaveBeenCalledWith('track-1');
      expect(adapter.saveToLibrary).toHaveBeenCalledWith('track-1');
    });

    it('skips saveToLibrary on a repeat super-like once the track is in the library', async () => {
      // isInLibrary reflects state: false before the first save, true afterwards.
      const adapter = buildMockAdapter({
        isInLibrary: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();
      expect(adapter.saveToLibrary).toHaveBeenCalledTimes(1);

      adapter.saveToLibrary.mockClear();

      // Second super-like — the live isInLibrary check now reports the track is
      // already saved, so saveToLibrary is skipped. No stale-skip shortcut: the
      // check runs every time, so a track un-liked between sessions would re-save.
      writer.superLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();
      expect(adapter.isInLibrary).toHaveBeenCalledTimes(2);
      expect(adapter.saveToLibrary).not.toHaveBeenCalled();
    });

    it('skips saveToLibrary entirely when track is already in library', async () => {
      const adapter = buildMockAdapter({
        isInLibrary: jest.fn().mockResolvedValue(true),
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      // Pre-existing track — saveToLibrary must not be called at all.
      expect(adapter.saveToLibrary).not.toHaveBeenCalled();

      // Undo — removeFromLibrary must also not be called (track not in libraryWrittenIds).
      writer.undoSuperLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();
      expect(adapter.removeFromLibrary).not.toHaveBeenCalled();
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

  describe('undoWrite()', () => {
    it('calls removeFromPlaylist for each destination', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.undoWrite('track-1', ['playlist-a', 'playlist-b']);
      await jest.runAllTimersAsync();

      expect(adapter.removeFromPlaylist).toHaveBeenCalledTimes(2);
      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith('playlist-a', 'track-1');
      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith('playlist-b', 'track-1');
    });

    it('is fire-and-forget — returns void synchronously', () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      expect(writer.undoWrite('track-1', ['playlist-a'])).toBeUndefined();
    });

    it('warns but does not throw when removeFromPlaylist fails', async () => {
      const adapter = buildMockAdapter({
        removeFromPlaylist: jest.fn().mockRejectedValue(new Error('remove failed')),
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.undoWrite('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[PlaylistWriter]'),
        expect.anything(),
      );
    });
  });

  describe('undoSuperLike()', () => {
    it('removes from playlists and from library when track was added by superLike', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      // Super-like records the track in libraryWrittenIds
      writer.superLike('track-1', ['playlist-a', 'playlist-b']);
      await jest.runAllTimersAsync();

      writer.undoSuperLike('track-1', ['playlist-a', 'playlist-b']);
      await jest.runAllTimersAsync();

      // undoSuperLike delegates to undoWrite([...destinations, LIKED_SONGS_PLAYLIST_ID]),
      // so removeFromPlaylist is called for each destination plus Liked Songs (3 total).
      expect(adapter.removeFromPlaylist).toHaveBeenCalledTimes(3);
      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith(LIKED_SONGS_PLAYLIST_ID, 'track-1');
    });

    it('removes from playlists but NOT from library when track was pre-existing in library', async () => {
      const adapter = buildMockAdapter({
        isInLibrary: jest.fn().mockResolvedValue(true), // already liked before super-like
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      writer.undoSuperLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith('playlist-a', 'track-1');
      expect(adapter.removeFromLibrary).not.toHaveBeenCalled();
    });

    it('does not call removeFromLibrary when track was never super-liked by us', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      // undoSuperLike without a prior superLike — libraryWrittenIds is empty
      writer.undoSuperLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      expect(adapter.removeFromLibrary).not.toHaveBeenCalled();
    });

    it('warns but does not throw when removeFromPlaylist for Liked Songs rejects', async () => {
      const adapter = buildMockAdapter({
        removeFromPlaylist: jest.fn().mockRejectedValue(
          new PlatformError(PlatformErrorCode.PERMISSION_DENIED, 'Spotify 403: Forbidden'),
        ),
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      writer.undoSuperLike('track-1', ['playlist-a']);
      await jest.runAllTimersAsync();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[PlaylistWriter] undoWrite removeFromLibrary failed for trackId=track-1'),
        expect.any(PlatformError),
      );
    });
  });

  describe('write() — Liked Songs destination', () => {
    it('calls addToPlaylist(LIKED_SONGS_PLAYLIST_ID) for a track not pre-existing in library', async () => {
      const adapter = buildMockAdapter({ isInLibrary: jest.fn().mockResolvedValue(false) });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      expect(adapter.isInLibrary).toHaveBeenCalledWith('track-1');
      expect(adapter.addToPlaylist).toHaveBeenCalledWith(LIKED_SONGS_PLAYLIST_ID, 'track-1');
    });

    it('skips addToPlaylist when track is pre-existing in library', async () => {
      const adapter = buildMockAdapter({ isInLibrary: jest.fn().mockResolvedValue(true) });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
    });

    it('skips addToPlaylist on a repeat write once the track is in the library', async () => {
      // isInLibrary reflects state: false before the first add, true afterwards.
      const adapter = buildMockAdapter({
        isInLibrary: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      // First write — track not in library yet, so it is added.
      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();
      expect(adapter.addToPlaylist).toHaveBeenCalledTimes(1);

      adapter.addToPlaylist.mockClear();

      // Second write — the live isInLibrary check now reports the track is present,
      // so the add is skipped (no duplicate). The check runs every time, so a track
      // removed from the library between sessions would be re-added.
      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();
      expect(adapter.isInLibrary).toHaveBeenCalledTimes(2);
      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
    });

    it('fires onLibraryWritten callback with the trackId after a successful add', async () => {
      const adapter = buildMockAdapter({ isInLibrary: jest.fn().mockResolvedValue(false) });
      const storage = buildMockStorage();
      const onLibraryWritten = jest.fn();
      const writer = new PlaylistWriter(adapter, storage, onLibraryWritten);

      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      expect(onLibraryWritten).toHaveBeenCalledWith('track-1');
    });

    it('does NOT persist to the write queue (LIKED_SONGS path bypasses queueing)', async () => {
      const adapter = buildMockAdapter({ isInLibrary: jest.fn().mockResolvedValue(false) });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      const raw = await storage.getItem('@music-swipe/playlist-write-queue');
      const queue: PendingWrite[] = raw ? (JSON.parse(raw) as PendingWrite[]) : [];
      expect(queue.find((e) => e.trackId === 'track-1')).toBeUndefined();
    });
  });

  describe('undoWrite() — Liked Songs destination', () => {
    it('calls removeFromPlaylist(LIKED_SONGS) after a successful write()', async () => {
      const adapter = buildMockAdapter({ isInLibrary: jest.fn().mockResolvedValue(false) });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      writer.undoWrite('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith(LIKED_SONGS_PLAYLIST_ID, 'track-1');
    });

    it('does NOT call removeFromPlaylist(LIKED_SONGS) when we never wrote it this session', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      // undoWrite without any prior write — libraryWrittenIds is empty
      writer.undoWrite('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      expect(adapter.removeFromPlaylist).not.toHaveBeenCalled();
    });
  });

  describe('undoWriteAsync()', () => {
    it('awaits removeFromPlaylist for a regular playlist destination', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      await writer.undoWriteAsync('track-1', ['playlist-a']);

      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith('playlist-a', 'track-1');
    });

    it('removes from multiple regular destinations in order', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      await writer.undoWriteAsync('track-1', ['playlist-a', 'playlist-b']);

      expect(adapter.removeFromPlaylist).toHaveBeenCalledTimes(2);
      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith('playlist-a', 'track-1');
      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith('playlist-b', 'track-1');
    });

    it('removes from Liked Songs when track was added by write() this session', async () => {
      const adapter = buildMockAdapter({ isInLibrary: jest.fn().mockResolvedValue(false) });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      // Populate libraryWrittenIds via write()
      writer.write('track-1', [LIKED_SONGS_PLAYLIST_ID]);
      await jest.runAllTimersAsync();

      await writer.undoWriteAsync('track-1', [LIKED_SONGS_PLAYLIST_ID]);

      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith(LIKED_SONGS_PLAYLIST_ID, 'track-1');
    });

    it('skips Liked Songs removal when track not in libraryWrittenIds', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      await writer.undoWriteAsync('track-1', [LIKED_SONGS_PLAYLIST_ID]);

      expect(adapter.removeFromPlaylist).not.toHaveBeenCalled();
    });

    it('throws when removeFromPlaylist rejects (unlike undoWrite which swallows)', async () => {
      const adapter = buildMockAdapter({
        removeFromPlaylist: jest.fn().mockRejectedValue(new Error('Spotify 500')),
      });
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      await expect(writer.undoWriteAsync('track-1', ['playlist-a'])).rejects.toThrow('Spotify 500');
    });

    it('returns a Promise (is awaitable)', () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      const result = writer.undoWriteAsync('track-1', ['playlist-a']);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('superLike() — filter mode (empty destinations)', () => {
    it('does not call addToPlaylist when destinations array is empty', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', []);
      await jest.runAllTimersAsync();

      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
    });

    it('still saves to library when destinations array is empty', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', []);
      await jest.runAllTimersAsync();

      expect(adapter.isInLibrary).toHaveBeenCalledWith('track-1');
      expect(adapter.saveToLibrary).toHaveBeenCalledWith('track-1');
    });
  });

  describe('undoSuperLike() — filter mode (empty destinations)', () => {
    it('removes from library after a filter-mode superLike', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', []);
      await jest.runAllTimersAsync();

      writer.undoSuperLike('track-1', []);
      await jest.runAllTimersAsync();

      // undoSuperLike([], []) → undoWrite(id, [LIKED_SONGS_PLAYLIST_ID])
      expect(adapter.removeFromPlaylist).toHaveBeenCalledWith(LIKED_SONGS_PLAYLIST_ID, 'track-1');
    });

    it('does not call removeFromPlaylist for any regular playlists', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.superLike('track-1', []);
      await jest.runAllTimersAsync();

      writer.undoSuperLike('track-1', []);
      await jest.runAllTimersAsync();

      // Only LIKED_SONGS removal — no regular playlist removal
      const regularCalls = (adapter.removeFromPlaylist.mock.calls as [string, string][])
        .filter(([pid]) => pid !== LIKED_SONGS_PLAYLIST_ID);
      expect(regularCalls).toHaveLength(0);
    });

    it('does not remove from library when filter-mode superLike was never called', async () => {
      const adapter = buildMockAdapter();
      const storage = buildMockStorage();
      const writer = new PlaylistWriter(adapter, storage);

      writer.undoSuperLike('track-1', []);
      await jest.runAllTimersAsync();

      expect(adapter.removeFromPlaylist).not.toHaveBeenCalled();
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
