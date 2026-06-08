import AsyncStorageDefault from '@react-native-async-storage/async-storage';
import { MusicPlatformAdapter, PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '../adapters/interface';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

// Minimum AsyncStorage surface needed — allows injection of a test double.
export interface StorageInterface {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// A single write operation waiting to be confirmed by the platform API.
export interface PendingWrite {
  trackId: string;
  playlistId: string;
  attempts: number;
}

// Identifies which write failed, passed to the onWriteError callback.
export interface WriteErrorContext {
  trackId: string;
  playlistId: string;
}

const QUEUE_KEY = '@music-swipe/playlist-write-queue';
const LIBRARY_WRITTEN_IDS_KEY = '@music-swipe/library-written-ids';
const ADDED_PLAYLIST_PAIRS_KEY = '@music-swipe/added-playlist-pairs';

export class PlaylistWriter {
  private readonly adapter: MusicPlatformAdapter;
  private readonly storage: StorageInterface;
  private readonly libraryWrittenIds = new Set<string>();
  private libraryWrittenIdsLoaded = false;
  // Regular-playlist pairs ("trackId|playlistId") this writer added and may undo.
  // A pair is recorded only when the track was NOT already in the playlist, so an
  // undo can never remove a track the user owned before the like. Persisted so a
  // fresh writer (History / session-end) can still tell its own adds apart.
  private readonly addedPlaylistPairs = new Set<string>();
  private addedPlaylistPairsLoaded = false;
  // Serializes durable-queue read-modify-write cycles. Without it, liking one track
  // into multiple regular playlists runs the destinations concurrently and a later
  // persistQueue overwrites an earlier one, dropping a crash-recovery entry.
  private queueMutex: Promise<void> = Promise.resolve();
  private readonly onLibraryWritten?: (trackId: string) => void;
  // Invoked when a write fails for a non-retryable reason (e.g. PERMISSION_DENIED,
  // NOT_FOUND). Rate-limit exhaustion is intentionally NOT reported here — those
  // entries stay in the durable queue and are retried on the next launch.
  private readonly onWriteError?: (error: unknown, context: WriteErrorContext) => void;

  constructor(
    adapter: MusicPlatformAdapter,
    storage: StorageInterface = AsyncStorageDefault,
    onLibraryWritten?: (trackId: string) => void,
    onWriteError?: (error: unknown, context: WriteErrorContext) => void,
  ) {
    this.adapter = adapter;
    this.storage = storage;
    this.onLibraryWritten = onLibraryWritten;
    this.onWriteError = onWriteError;
  }

  // Surfaces a non-retryable write failure instead of swallowing it: logs it and
  // notifies onWriteError so the UI can tell the user the save did not land.
  private reportWriteError(error: unknown, context: WriteErrorContext): void {
    console.warn(
      `[PlaylistWriter] write failed (non-retryable) for trackId=${context.trackId} playlistId=${context.playlistId}:`,
      error,
    );
    this.onWriteError?.(error, context);
  }

  private async ensureLibraryWrittenIdsLoaded(): Promise<void> {
    if (this.libraryWrittenIdsLoaded) return;
    try {
      const raw = await this.storage.getItem(LIBRARY_WRITTEN_IDS_KEY);
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        for (const id of ids) this.libraryWrittenIds.add(id);
      }
    } catch {
      // start fresh on parse error
    }
    this.libraryWrittenIdsLoaded = true;
  }

  private async persistLibraryWrittenIds(): Promise<void> {
    try {
      await this.storage.setItem(LIBRARY_WRITTEN_IDS_KEY, JSON.stringify([...this.libraryWrittenIds]));
    } catch (err) {
      console.warn('[PlaylistWriter] persistLibraryWrittenIds failed:', err);
    }
  }

  // Stable key identifying a single (trackId, playlistId) addition.
  private pairKey(trackId: string, playlistId: string): string {
    return `${trackId}|${playlistId}`;
  }

  private async ensureAddedPlaylistPairsLoaded(): Promise<void> {
    if (this.addedPlaylistPairsLoaded) return;
    try {
      const raw = await this.storage.getItem(ADDED_PLAYLIST_PAIRS_KEY);
      if (raw) {
        const pairs = JSON.parse(raw) as string[];
        for (const pair of pairs) this.addedPlaylistPairs.add(pair);
      }
    } catch {
      // start fresh on parse error
    }
    this.addedPlaylistPairsLoaded = true;
  }

  private async persistAddedPlaylistPairs(): Promise<void> {
    try {
      await this.storage.setItem(ADDED_PLAYLIST_PAIRS_KEY, JSON.stringify([...this.addedPlaylistPairs]));
    } catch (err) {
      console.warn('[PlaylistWriter] persistAddedPlaylistPairs failed:', err);
    }
  }

  // Reads the persisted queue; returns an empty array on parse error or absence.
  private async readQueue(): Promise<PendingWrite[]> {
    try {
      const raw = await this.storage.getItem(QUEUE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as PendingWrite[];
    } catch {
      return [];
    }
  }

  // Overwrites the persisted queue with the supplied entries.
  private async persistQueue(pending: PendingWrite[]): Promise<void> {
    try {
      await this.storage.setItem(QUEUE_KEY, JSON.stringify(pending));
    } catch (err) {
      console.warn('[PlaylistWriter] persistQueue failed:', err);
    }
  }

  // Runs a queue read-modify-write critical section serialized against all others.
  // Each call chains onto the previous mutation so concurrent destinations can't both
  // read the same snapshot and clobber each other's persistQueue. Errors are isolated
  // so one failed section never poisons the chain for later callers.
  private runExclusiveQueueMutation<T>(criticalSection: () => Promise<T>): Promise<T> {
    const result = this.queueMutex.then(criticalSection);
    this.queueMutex = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // Adds a (trackId, playlistId) pair to the durable queue unless already present.
  // Serialized so parallel destination writes don't drop each other's entries.
  private async enqueueWrite(trackId: string, playlistId: string): Promise<void> {
    await this.runExclusiveQueueMutation(async () => {
      const queue = await this.readQueue();
      const alreadyQueued = queue.some(
        (e) => e.trackId === trackId && e.playlistId === playlistId,
      );
      if (!alreadyQueued) {
        queue.push({ trackId, playlistId, attempts: 0 });
        await this.persistQueue(queue);
      }
    });
  }

  // Removes a single entry from the persisted queue by (trackId, playlistId) identity.
  // Serialized via the same mutex as enqueueWrite so reads and writes never interleave.
  private async removeFromQueue(trackId: string, playlistId: string): Promise<void> {
    await this.runExclusiveQueueMutation(async () => {
      const queue = await this.readQueue();
      const next = queue.filter((e) => !(e.trackId === trackId && e.playlistId === playlistId));
      await this.persistQueue(next);
    });
  }

  // Core retry loop shared by executeWithBackoff and drainStoredQueue.
  // Calls fn on each attempt, starting from startAttempt, retrying only on RATE_LIMITED.
  // Uses exponential backoff with jitter between attempts.
  // onNonRetryable is invoked (once) when a non-RATE_LIMITED error terminates the loop.
  // onExhausted is invoked (once) when MAX_ATTEMPTS is reached without success.
  // Returns true on success, false on any early exit.
  private static async retryLoop(
    fn: () => Promise<void>,
    startAttempt: number,
    onNonRetryable: (error: unknown) => void,
    onExhausted: (error: unknown) => void,
  ): Promise<boolean> {
    for (let attempt = startAttempt; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await fn();
        return true;
      } catch (error) {
        const isRateLimited =
          error instanceof PlatformError && error.code === PlatformErrorCode.RATE_LIMITED;

        if (!isRateLimited) {
          onNonRetryable(error);
          return false;
        }

        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        if (isLastAttempt) {
          onExhausted(error);
          return false;
        }

        // Exponential backoff: BASE_DELAY_MS * 2^attempt + random jitter up to 200ms
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  // Retries fn up to MAX_ATTEMPTS times, only on RATE_LIMITED errors.
  // Uses exponential backoff with jitter. Never throws to caller.
  // Returns true when fn succeeded, false when all retries were exhausted or a
  // non-retryable error was encountered — lets the caller decide what to do with
  // persisted queue state.
  private async executeWithBackoff(
    fn: () => Promise<void>,
    context: WriteErrorContext,
  ): Promise<boolean> {
    return PlaylistWriter.retryLoop(
      fn,
      /* startAttempt */ 0,
      /* onNonRetryable */ (error) => {
        // Non-retryable error — surface it (don't swallow) and exit immediately
        this.reportWriteError(error, context);
      },
      /* onExhausted */ (error) => {
        console.warn('[PlaylistWriter] Max retry attempts reached after RATE_LIMITED:', error);
      },
    );
  }

  // Checks whether the given track already exists in the user's library before any
  // write attempt. Conservative default: if isInLibrary throws, the result is true
  // (pre-existing), so an undo can never accidentally remove a track the user already
  // had liked before this session.
  // Also ensures libraryWrittenIds is loaded from storage before the check.
  private async isTrackPreExistingInLibrary(trackId: string): Promise<boolean> {
    await this.ensureLibraryWrittenIdsLoaded();
    let preExisting = true;
    try { preExisting = await this.adapter.isInLibrary(trackId); } catch { /* keep conservative */ }
    return preExisting;
  }

  // Fires addToPlaylist for each destination in parallel — fire-and-forget (no await at call site).
  // Persists each entry to AsyncStorage before the network call so that a crash
  // between write() and the API response can be recovered via drainStoredQueue.
  // No cross-session write deduplication: a like always re-attempts the add, so a
  // destination playlist the user edited between sessions is corrected. Regular
  // playlists may accumulate duplicates (Spotify permits them); the optional
  // post-session dedup scan removes any extras. Liked Songs cannot duplicate
  // (the library is a set) and is additionally guarded by the live isInLibrary check.
  write(trackId: string, destinationIds: string[]): void {
    const writes = destinationIds.map((playlistId) =>
      playlistId === LIKED_SONGS_PLAYLIST_ID
        ? this.writeToLibrary(trackId)
        : this.writeToRegularPlaylist(trackId, playlistId),
    );

    // Intentionally not awaited — swipe UI must not be blocked.
    void Promise.all(writes);
  }

  // Saves a track to Liked Songs. Only records it as "ours to remove" when it was not
  // already in the library (live isInLibrary check, no stale skip), so undo can never
  // remove a track the user had liked before this session.
  private async writeToLibrary(trackId: string): Promise<void> {
    const preExisting = await this.isTrackPreExistingInLibrary(trackId);
    if (preExisting) return;

    const succeeded = await this.executeWithBackoff(
      () => this.adapter.addToPlaylist(LIKED_SONGS_PLAYLIST_ID, trackId),
      { trackId, playlistId: LIKED_SONGS_PLAYLIST_ID },
    );
    if (succeeded) {
      this.libraryWrittenIds.add(trackId);
      void this.persistLibraryWrittenIds();
      this.onLibraryWritten?.(trackId);
    }
  }

  // Adds a track to a regular playlist with durable-queue retry. Records the pair as
  // "ours to remove" only when the track was not already in the playlist, mirroring the
  // Liked Songs guard so an undo can never delete a track the user already owned.
  private async writeToRegularPlaylist(trackId: string, playlistId: string): Promise<void> {
    await this.ensureAddedPlaylistPairsLoaded();
    // Snapshot pre-existence BEFORE the add. Conservative default: on check failure
    // treat as pre-existing (never record), so undo can't delete a track we're unsure of.
    const preExisting = await this.isTrackPreExistingInPlaylist(trackId, playlistId);

    await this.enqueueWrite(trackId, playlistId);

    const succeeded = await this.executeWithBackoff(
      () => this.adapter.addToPlaylist(playlistId, trackId),
      { trackId, playlistId },
    );

    if (!succeeded) {
      // All retries exhausted or non-retryable — leave the entry in the queue for
      // next-launch recovery via drainStoredQueue.
      console.warn(
        `[PlaylistWriter] write failed for trackId=${trackId} playlistId=${playlistId}; kept in queue for next-launch retry`,
      );
      return;
    }

    await this.removeFromQueue(trackId, playlistId);
    if (!preExisting) {
      this.addedPlaylistPairs.add(this.pairKey(trackId, playlistId));
      void this.persistAddedPlaylistPairs();
    }
  }

  // Checks whether the track is already in the playlist before any write. Conservative
  // default: if the check throws, returns true (treated as pre-existing) so undo can
  // never remove a track the writer is not sure it added.
  private async isTrackPreExistingInPlaylist(trackId: string, playlistId: string): Promise<boolean> {
    try {
      return await this.adapter.isInPlaylist(playlistId, trackId);
    } catch {
      return true;
    }
  }

  // Fire-and-forget removal for undo. Clears the written-pairs record so a future
  // swipe can re-add the track if the user changes their mind.
  undoWrite(trackId: string, destinationIds: string[]): void {
    for (const playlistId of destinationIds) {
      if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
        // Only remove from library if WE added it this session; pre-existing liked
        // songs must be left untouched even after an undo.
        void (async () => {
          await this.ensureLibraryWrittenIdsLoaded();
          if (!this.libraryWrittenIds.has(trackId)) return;
          try {
            await this.adapter.removeFromPlaylist(playlistId, trackId);
            this.libraryWrittenIds.delete(trackId);
            void this.persistLibraryWrittenIds();
          } catch (err: unknown) {
            console.warn(`[PlaylistWriter] undoWrite removeFromLibrary failed for trackId=${trackId}:`, err);
          }
        })();
        continue;
      }

      // Regular playlist: only remove what we added this session. A pre-existing track
      // the user already owned was never recorded, so it is left untouched.
      void (async () => {
        await this.ensureAddedPlaylistPairsLoaded();
        const key = this.pairKey(trackId, playlistId);
        if (!this.addedPlaylistPairs.has(key)) return;
        try {
          await this.adapter.removeFromPlaylist(playlistId, trackId);
          this.addedPlaylistPairs.delete(key);
          void this.persistAddedPlaylistPairs();
        } catch (err: unknown) {
          console.warn(`[PlaylistWriter] undoWrite failed for trackId=${trackId} playlistId=${playlistId}:`, err);
        }
      })();
    }
  }

  // Awaitable undo for callers that need to surface errors to the user (e.g. history
  // and session-end pages). Mirrors undoWrite logic but throws on API failure instead
  // of swallowing the error with console.warn.
  // For Liked Songs: only removes if we added it this session — pre-existing liked
  // songs are skipped entirely (same guard as undoWrite).
  async undoWriteAsync(trackId: string, destinationIds: string[]): Promise<void> {
    await this.ensureAddedPlaylistPairsLoaded();
    for (const playlistId of destinationIds) {
      if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
        await this.ensureLibraryWrittenIdsLoaded();
        if (!this.libraryWrittenIds.has(trackId)) continue;
        await this.adapter.removeFromPlaylist(playlistId, trackId);
        this.libraryWrittenIds.delete(trackId);
        void this.persistLibraryWrittenIds();
        continue;
      }

      // Regular playlist: only remove what we added this session — never a pre-existing
      // track the user already owned (which was never recorded as ours).
      const key = this.pairKey(trackId, playlistId);
      if (!this.addedPlaylistPairs.has(key)) continue;
      await this.adapter.removeFromPlaylist(playlistId, trackId);
      this.addedPlaylistPairs.delete(key);
      void this.persistAddedPlaylistPairs();
    }
  }

  // Unconditionally removes a track from Liked Songs, bypassing the libraryWrittenIds
  // guard. For callers with authoritative knowledge that WE wrote it — e.g. a
  // History cancel of a record whose persisted likedSongsWrittenByUs flag is true,
  // where the per-device libraryWrittenIds set is empty after a clear + restore.
  // Throws on API failure so the caller can surface it.
  async removeFromLibrary(trackId: string): Promise<void> {
    await this.adapter.removeFromPlaylist(LIKED_SONGS_PLAYLIST_ID, trackId);
    // Keep the local guard consistent if it happened to hold this id.
    if (this.libraryWrittenIds.has(trackId)) {
      this.libraryWrittenIds.delete(trackId);
      void this.persistLibraryWrittenIds();
    }
  }

  // Undo a super-like: removes from destination playlists and from library,
  // delegating both to undoWrite (which guards the library removal behind libraryWrittenIds).
  undoSuperLike(trackId: string, destinationIds: string[]): void {
    this.undoWrite(trackId, [...destinationIds, LIKED_SONGS_PLAYLIST_ID]);
  }

  // Super-like: writes to all destinations AND saves to library, both fire-and-forget.
  // Checks if the track is already liked before adding — if pre-existing, the library save
  // still fires (Spotify reorders it to the top) but the track is not recorded as "ours to
  // remove", so undoSuperLike will leave it in the library.
  superLike(trackId: string, destinationIds: string[]): void {
    this.write(trackId, destinationIds);
    void (async () => {
      // No stale skip: the live isInLibrary check inside isTrackPreExistingInLibrary
      // decides every time, so a track removed from the library between sessions is
      // re-saved. Conservative default: treat as pre-existing on check failure.
      const preExisting = await this.isTrackPreExistingInLibrary(trackId);

      // If already liked, leave it untouched — same logic as write() for Liked Songs.
      if (preExisting) return;

      try {
        await this.adapter.saveToLibrary(trackId);
        this.libraryWrittenIds.add(trackId);
        void this.persistLibraryWrittenIds();
        this.onLibraryWritten?.(trackId);
      } catch (error: unknown) {
        // saveToLibrary bypasses executeWithBackoff, so surface its failures here too.
        this.reportWriteError(error, { trackId, playlistId: LIKED_SONGS_PLAYLIST_ID });
      }
    })();
  }

  // Reads the persisted queue from AsyncStorage and retries each entry.
  // Entries that succeed are removed; entries that exhaust MAX_ATTEMPTS are
  // left for the next launch. Intended to run once at app startup during the
  // flushing phase, before new swipe sessions begin.
  static async drainStoredQueue(
    adapter: MusicPlatformAdapter,
    storage: StorageInterface = AsyncStorageDefault,
  ): Promise<void> {
    let queue: PendingWrite[];
    try {
      const raw = await storage.getItem(QUEUE_KEY);
      if (!raw) return;
      queue = JSON.parse(raw) as PendingWrite[];
    } catch {
      return;
    }

    if (queue.length === 0) return;

    const remaining: PendingWrite[] = [];

    for (const entry of queue) {
      const succeeded = await PlaylistWriter.retryLoop(
        () => adapter.addToPlaylist(entry.playlistId, entry.trackId),
        /* startAttempt */ entry.attempts,
        /* onNonRetryable */ (error) => {
          console.warn(
            `[PlaylistWriter] drainStoredQueue non-retryable error for trackId=${entry.trackId}:`,
            error,
          );
        },
        /* onExhausted */ (_error) => {
          console.warn(
            `[PlaylistWriter] drainStoredQueue exhausted retries for trackId=${entry.trackId}`,
          );
        },
      );

      if (!succeeded) {
        // Reset attempts to 0 so the next launch retries this entry from scratch.
        // Persisting MAX_ATTEMPTS here would make the next launch's loop
        // (`for (attempt = entry.attempts; attempt < MAX_ATTEMPTS; ...)`) a no-op,
        // permanently abandoning the write even after connectivity is restored.
        remaining.push({ ...entry, attempts: 0 });
      }
    }

    // Persist only the entries that could not be completed.
    if (remaining.length === 0) {
      await storage.removeItem(QUEUE_KEY);
    } else {
      await storage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    }
  }
}
