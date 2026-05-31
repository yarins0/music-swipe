import { PlaylistWriter, StorageInterface } from '../PlaylistWriter';
import { MockAdapter } from '../../adapters/mock/MockAdapter';
import { LIKED_SONGS_PLAYLIST_ID } from '../../adapters/interface';

// In-memory StorageInterface stub — mimics AsyncStorage without native modules.
function buildMockStorage(initial: Record<string, string> = {}): jest.Mocked<StorageInterface> {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
  };
}

// DEFAULT_PLAYLISTS in MockAdapter — these IDs won't throw NOT_FOUND.
const DEST1 = 'mock-playlist-1';
const DEST2 = 'mock-playlist-2';

function setup(adapterOverrides: ConstructorParameters<typeof MockAdapter>[0] = {}) {
  const adapter = new MockAdapter(adapterOverrides);
  const storage = buildMockStorage();
  const writer = new PlaylistWriter(adapter, storage);
  return { adapter, storage, writer };
}

describe('PlaylistWriter – stateful action sequences', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const flush = () => jest.runAllTimersAsync();

  // ─────────────────────────────────────────────
  // 1. Regular mode — single destination
  // ─────────────────────────────────────────────
  describe('regular mode — single destination', () => {
    it('like: track lands in playlist', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
    });

    it('like → undo: track removed', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      writer.undoWrite('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(false);
    });

    it('like → undo → re-like: track back in playlist (undo cleared writtenPairs)', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      writer.undoWrite('t1', [DEST1]);
      await flush();
      writer.write('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
    });

    it('like → undoWriteAsync (end-screen): track removed, awaitable', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      await writer.undoWriteAsync('t1', [DEST1]);
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(false);
    });

    it('undoWrite → undoWriteAsync (double-undo): removeFromPlaylist called twice, track absent', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      writer.undoWrite('t1', [DEST1]);
      await flush();
      await writer.undoWriteAsync('t1', [DEST1]);
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(false);
      expect(
        adapter.calls.removeFromPlaylist.filter((c) => c.playlistId === DEST1 && c.trackId === 't1'),
      ).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────
  // 2. Regular mode — multiple destinations
  // ─────────────────────────────────────────────
  describe('regular mode — multiple destinations', () => {
    it('like: track lands in both playlists', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1, DEST2]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
      expect(adapter.playlistContents.get(DEST2)?.has('t1')).toBe(true);
    });

    it('like → undo: removed from both playlists', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1, DEST2]);
      await flush();
      writer.undoWrite('t1', [DEST1, DEST2]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(false);
      expect(adapter.playlistContents.get(DEST2)?.has('t1')).toBe(false);
    });

    it('like → undo → re-like: back in both playlists', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1, DEST2]);
      await flush();
      writer.undoWrite('t1', [DEST1, DEST2]);
      await flush();
      writer.write('t1', [DEST1, DEST2]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
      expect(adapter.playlistContents.get(DEST2)?.has('t1')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 3. Liked Songs as destination
  // ─────────────────────────────────────────────
  describe('Liked Songs as destination', () => {
    it('like: track saved to library', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
    });

    it('like → undo: track removed from library', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      writer.undoWrite('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(false);
    });

    it('like → undo → re-like: re-added to library', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      writer.undoWrite('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      writer.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
    });

    it('like → undoWriteAsync (end-screen): track removed from library', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      await writer.undoWriteAsync('t1', [LIKED_SONGS_PLAYLIST_ID]);
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(false);
    });

    it('pre-existing: write skips library, undo is a no-op', async () => {
      const { adapter, writer } = setup({ likedTrackIds: new Set(['t1']) });
      writer.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      // Pre-existing guard: isInLibrary returned true → saveToLibrary never called
      expect(adapter.calls.saveToLibrary).toHaveLength(0);
      // Undo: libraryWrittenIds has no entry for t1 → skip
      writer.undoWrite('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      expect(adapter.calls.removeFromLibrary).toHaveLength(0);
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
    });

    it('pre-existing → undoWriteAsync: no-op, track stays in library', async () => {
      const { adapter, writer } = setup({ likedTrackIds: new Set(['t1']) });
      writer.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      await writer.undoWriteAsync('t1', [LIKED_SONGS_PLAYLIST_ID]);
      expect(adapter.calls.removeFromLibrary).toHaveLength(0);
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 4. Super like with destinations
  // ─────────────────────────────────────────────
  describe('super like with destinations', () => {
    it('superLike: track in playlist AND library', async () => {
      const { adapter, writer } = setup();
      writer.superLike('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
    });

    it('superLike → undoSuperLike: removed from playlist and library', async () => {
      const { adapter, writer } = setup();
      writer.superLike('t1', [DEST1]);
      await flush();
      writer.undoSuperLike('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(false);
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(false);
    });

    it('superLike → undoSuperLike → superLike: back in both', async () => {
      const { adapter, writer } = setup();
      writer.superLike('t1', [DEST1]);
      await flush();
      writer.undoSuperLike('t1', [DEST1]);
      await flush();
      writer.superLike('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
    });

    it('pre-existing liked: superLike adds to playlist only; undoSuperLike removes playlist only', async () => {
      const { adapter, writer } = setup({ likedTrackIds: new Set(['t1']) });
      writer.superLike('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
      // Pre-existing: saveToLibrary never called, libraryWrittenIds has no entry
      expect(adapter.calls.saveToLibrary).toHaveLength(0);
      writer.undoSuperLike('t1', [DEST1]);
      await flush();
      // Playlist cleared
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(false);
      // Library untouched — undo guard: libraryWrittenIds has no entry for t1
      expect(adapter.calls.removeFromLibrary).toHaveLength(0);
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // 5. Filter mode (empty destinations)
  // ─────────────────────────────────────────────
  describe('filter mode (empty destinations)', () => {
    it('superLike([], track): library gains track, no playlist touched', async () => {
      const { adapter, writer } = setup();
      writer.superLike('t1', []);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
      expect(adapter.playlistContents.size).toBe(0);
    });

    it('superLike → undoSuperLike: track removed from library', async () => {
      const { adapter, writer } = setup();
      writer.superLike('t1', []);
      await flush();
      writer.undoSuperLike('t1', []);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(false);
    });

    it('pre-existing in filter mode: superLike is no-op on library, undoSuperLike leaves library intact', async () => {
      const { adapter, writer } = setup({ likedTrackIds: new Set(['t1']) });
      writer.superLike('t1', []);
      await flush();
      expect(adapter.calls.saveToLibrary).toHaveLength(0);
      writer.undoSuperLike('t1', []);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
      expect(adapter.calls.removeFromLibrary).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────
  // 6. undoWriteAsync error propagation
  // ─────────────────────────────────────────────
  describe('undoWriteAsync error propagation', () => {
    it('rejects when removeFromPlaylist throws', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      jest.spyOn(adapter, 'removeFromPlaylist').mockRejectedValueOnce(new Error('API error'));
      await expect(writer.undoWriteAsync('t1', [DEST1])).rejects.toThrow('API error');
    });

    it('undoWrite swallows the error — warns but does not throw', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      jest.spyOn(adapter, 'removeFromPlaylist').mockRejectedValueOnce(new Error('API error'));
      expect(() => writer.undoWrite('t1', [DEST1])).not.toThrow();
      await flush();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('undoWrite failed'),
        expect.any(Error),
      );
    });
  });
});
