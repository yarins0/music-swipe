import { PlaylistWriter, StorageInterface, PendingWrite } from '../PlaylistWriter';
import { MockAdapter } from '../../adapters/mock/MockAdapter';
import { LIKED_SONGS_PLAYLIST_ID } from '../../adapters/interface';

const QUEUE_KEY = '@music-swipe/playlist-write-queue';

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

    it('like → undo → re-like: track back in playlist (no cross-session dedup blocks the re-add)', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      writer.undoWrite('t1', [DEST1]);
      await flush();
      writer.write('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
    });

    it('between sessions: a fresh writer re-adds the same pair after the playlist was edited', async () => {
      // Reproduces the reported bug: the user likes a track, removes it from the
      // destination playlist in Spotify between sessions, then re-likes it. With the
      // old cross-session writtenPairs dedup the re-like was silently skipped; now it
      // must land again. Shared storage simulates the persisted state across sessions.
      const adapter = new MockAdapter();
      const storage = buildMockStorage();

      const session1 = new PlaylistWriter(adapter, storage);
      session1.write('t1', [DEST1]);
      await flush();
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);

      // User removes the track from the playlist between sessions.
      adapter.playlistContents.get(DEST1)!.delete('t1');

      const session2 = new PlaylistWriter(adapter, storage);
      session2.write('t1', [DEST1]);
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

    it('undoWrite → undoWriteAsync (double-undo): removed once, second undo is a no-op, track absent', async () => {
      const { adapter, writer } = setup();
      writer.write('t1', [DEST1]);
      await flush();
      writer.undoWrite('t1', [DEST1]);
      await flush();
      // The first undo already gave back our added copy and cleared the recorded pair,
      // so the second undo finds nothing of ours to remove and does not call the API again.
      await writer.undoWriteAsync('t1', [DEST1]);
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(false);
      expect(
        adapter.calls.removeFromPlaylist.filter((c) => c.playlistId === DEST1 && c.trackId === 't1'),
      ).toHaveLength(1);
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

    it('between sessions: a fresh writer re-saves to library after the user un-liked the track', async () => {
      // The stale libraryWrittenIds skip persisted across sessions and would block
      // the re-save even though the user removed the track from Liked Songs. The live
      // isInLibrary check now decides every time, so the re-like must re-save.
      const adapter = new MockAdapter();
      const storage = buildMockStorage();

      const session1 = new PlaylistWriter(adapter, storage);
      session1.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);

      // User removes the track from Liked Songs between sessions.
      adapter.fixtures.likedTrackIds.delete('t1');

      const session2 = new PlaylistWriter(adapter, storage);
      session2.write('t1', [LIKED_SONGS_PLAYLIST_ID]);
      await flush();
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);
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

    it('removeFromLibrary: removes a restored track from the library with an empty libraryWrittenIds set', async () => {
      // Track is in the library but a fresh writer has no libraryWrittenIds entry
      // (the clear + restore case). The guarded undo path would skip it; the force
      // path removes it because the caller has the restored likedSongsWrittenByUs flag.
      const { adapter, writer } = setup({ likedTrackIds: new Set(['t1']) });

      await writer.undoWriteAsync('t1', [LIKED_SONGS_PLAYLIST_ID]); // guarded: no-op
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(true);

      await writer.removeFromLibrary('t1'); // force: removes it
      expect(adapter.fixtures.likedTrackIds.has('t1')).toBe(false);
      expect(adapter.calls.removeFromLibrary).toContain('t1');
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

  // ─────────────────────────────────────────────
  // 7. H3 — durable-queue race: a failed entry survives a concurrent write
  // ─────────────────────────────────────────────
  describe('durable-queue race (H3)', () => {
    it('liking into two playlists concurrently keeps the failed entry in the queue', async () => {
      // Both destinations run concurrently inside one write(). DEST2's add succeeds and
      // removes its queue entry; DEST1's add fails non-retryably and must stay queued for
      // next-launch recovery. Without serialized queue mutations the concurrent persists
      // race and DEST1's entry is lost.
      const { adapter, storage, writer } = setup();
      jest.spyOn(adapter, 'addToPlaylist').mockImplementation(async (playlistId: string) => {
        if (playlistId === DEST1) throw new Error('add failed');
      });

      writer.write('t1', [DEST1, DEST2]);
      await flush();

      const raw = await storage.getItem(QUEUE_KEY);
      const queue: PendingWrite[] = raw ? (JSON.parse(raw) as PendingWrite[]) : [];
      expect(queue).toContainEqual(
        expect.objectContaining({ trackId: 't1', playlistId: DEST1 }),
      );
      // DEST2 succeeded — its entry must not linger.
      expect(queue.some((e) => e.playlistId === DEST2)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // 8. H5 — undo never deletes a pre-existing track
  // ─────────────────────────────────────────────
  describe('undo guard for pre-existing tracks (H5)', () => {
    it('like a track already in the playlist → undo leaves it untouched', async () => {
      const { adapter, writer } = setup();
      // Pre-seed the destination with X as if the user already had it there.
      adapter.playlistContents.set(DEST1, new Set(['X']));

      writer.write('X', [DEST1]);
      await flush();
      writer.undoWrite('X', [DEST1]);
      await flush();

      // X must survive (one copy) — it pre-existed, so the writer never claimed it.
      expect(adapter.playlistContents.get(DEST1)?.has('X')).toBe(true);
      expect(adapter.playlistContents.get(DEST1)?.size).toBe(1);
      // The guard means no removal was ever attempted for the pre-existing pair.
      expect(
        adapter.calls.removeFromPlaylist.some((c) => c.playlistId === DEST1 && c.trackId === 'X'),
      ).toBe(false);
    });

    it('undoWriteAsync (end-screen) also leaves a pre-existing track untouched', async () => {
      const { adapter, writer } = setup();
      adapter.playlistContents.set(DEST1, new Set(['X']));

      writer.write('X', [DEST1]);
      await flush();
      await writer.undoWriteAsync('X', [DEST1]);

      expect(adapter.playlistContents.get(DEST1)?.has('X')).toBe(true);
      expect(adapter.playlistContents.get(DEST1)?.size).toBe(1);
    });
  });

  // ─────────────────────────────────────────────
  // 9. M2 — writeAndWait resolves only after writes land
  // ─────────────────────────────────────────────
  describe('writeAndWait — awaitable completion (M2)', () => {
    it('awaiting writeAndWait is enough — no flush needed for the track to be present', async () => {
      // The session-end "Save as playlist" button relies on this: once writeAndWait
      // resolves, the playlist genuinely contains the track, so showing "Saved ✓" is
      // truthful. (No flush() — the await alone must have drained the write.)
      const { adapter, writer } = setup();
      await writer.writeAndWait('t1', [DEST1]);
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
    });

    it('lands the track in every destination before resolving', async () => {
      const { adapter, writer } = setup();
      await writer.writeAndWait('t1', [DEST1, DEST2]);
      expect(adapter.playlistContents.get(DEST1)?.has('t1')).toBe(true);
      expect(adapter.playlistContents.get(DEST2)?.has('t1')).toBe(true);
    });
  });
});
