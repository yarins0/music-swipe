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

export class PlaylistWriter {
  private readonly adapter: MusicPlatformAdapter;
  private readonly storage: StorageInterface;
  private readonly libraryWrittenIds = new Set<string>();
  private libraryWrittenIdsLoaded = false;
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

  // Removes a single entry from the persisted queue by (trackId, playlistId) identity.
  private async removeFromQueue(trackId: string, playlistId: string): Promise<void> {
    const queue = await this.readQueue();
    const next = queue.filter((e) => !(e.trackId === trackId && e.playlistId === playlistId));
    await this.persistQueue(next);
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
    const writes = destinationIds.map(async (playlistId) => {
      // Liked Songs requires a pre-existing check: only record as "ours to remove"
      // if the track was not already in the library before this swipe. The live
      // isInLibrary check runs on every like (no stale skip), so a track the user
      // removed from their library between sessions is re-saved.
      if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
        // Conservative default: if the check throws, isTrackPreExistingInLibrary
        // returns true — undo can never accidentally remove a track the user already
        // had liked. The live check runs every time, so a track the user removed from
        // their library between sessions is re-saved.
        const preExisting = await this.isTrackPreExistingInLibrary(trackId);

        // If the track was already in Liked Songs, leave it untouched. We never
        // write it, so libraryWrittenIds never records it, and undo can never remove it.
        if (preExisting) return;

        const succeeded = await this.executeWithBackoff(
          () => this.adapter.addToPlaylist(playlistId, trackId),
          { trackId, playlistId },
        );
        if (succeeded) {
          this.libraryWrittenIds.add(trackId);
          void this.persistLibraryWrittenIds();
          this.onLibraryWritten?.(trackId);
        }
        return;
      }

      // 1. Add to durable queue before attempting the network call.
      const queue = await this.readQueue();
      const alreadyQueued = queue.some(
        (e) => e.trackId === trackId && e.playlistId === playlistId,
      );
      if (!alreadyQueued) {
        queue.push({ trackId, playlistId, attempts: 0 });
        await this.persistQueue(queue);
      }

      // 2. Attempt the write with exponential backoff.
      const succeeded = await this.executeWithBackoff(async () => {
        await this.adapter.addToPlaylist(playlistId, trackId);
      }, { trackId, playlistId });

      if (succeeded) {
        // 3a. Success — remove from the durable queue.
        await this.removeFromQueue(trackId, playlistId);
      } else {
        // 3b. All retries exhausted or non-retryable error — leave entry in queue for
        //     next-launch recovery via drainStoredQueue.
        console.warn(
          `[PlaylistWriter] write failed for trackId=${trackId} playlistId=${playlistId}; kept in queue for next-launch retry`,
        );
      }
    });

    // Intentionally not awaited — swipe UI must not be blocked.
    void Promise.all(writes);
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

      this.adapter.removeFromPlaylist(playlistId, trackId).catch((err: unknown) => {
        console.warn(`[PlaylistWriter] undoWrite failed for trackId=${trackId} playlistId=${playlistId}:`, err);
      });
    }
  }

  // Awaitable undo for callers that need to surface errors to the user (e.g. history
  // and session-end pages). Mirrors undoWrite logic but throws on API failure instead
  // of swallowing the error with console.warn.
  // For Liked Songs: only removes if we added it this session — pre-existing liked
  // songs are skipped entirely (same guard as undoWrite).
  async undoWriteAsync(trackId: string, destinationIds: string[]): Promise<void> {
    for (const playlistId of destinationIds) {
      if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
        await this.ensureLibraryWrittenIdsLoaded();
        if (!this.libraryWrittenIds.has(trackId)) continue;
        await this.adapter.removeFromPlaylist(playlistId, trackId);
        this.libraryWrittenIds.delete(trackId);
        void this.persistLibraryWrittenIds();
        continue;
      }

      await this.adapter.removeFromPlaylist(playlistId, trackId);
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
