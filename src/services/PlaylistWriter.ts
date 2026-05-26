import AsyncStorageDefault from '@react-native-async-storage/async-storage';
import { MusicPlatformAdapter, PlatformError, PlatformErrorCode } from '../adapters/interface';

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

const QUEUE_KEY = '@music-swipe/playlist-write-queue';
const WRITTEN_PAIRS_KEY = '@music-swipe/written-pairs';
const LIBRARY_WRITTEN_IDS_KEY = '@music-swipe/library-written-ids';

export class PlaylistWriter {
  private readonly adapter: MusicPlatformAdapter;
  private readonly storage: StorageInterface;
  private readonly writtenPairs = new Set<string>();
  private writtenPairsLoaded = false;
  private readonly libraryWrittenIds = new Set<string>();
  private libraryWrittenIdsLoaded = false;

  constructor(adapter: MusicPlatformAdapter, storage: StorageInterface = AsyncStorageDefault) {
    this.adapter = adapter;
    this.storage = storage;
  }

  private pairKey(trackId: string, playlistId: string): string {
    return `${trackId}::${playlistId}`;
  }

  private async ensureWrittenPairsLoaded(): Promise<void> {
    if (this.writtenPairsLoaded) return;
    try {
      const raw = await this.storage.getItem(WRITTEN_PAIRS_KEY);
      if (raw) {
        const pairs = JSON.parse(raw) as string[];
        for (const pair of pairs) this.writtenPairs.add(pair);
      }
    } catch {
      // start fresh on parse error
    }
    this.writtenPairsLoaded = true;
  }

  private async persistWrittenPairs(): Promise<void> {
    try {
      await this.storage.setItem(WRITTEN_PAIRS_KEY, JSON.stringify([...this.writtenPairs]));
    } catch (err) {
      console.warn('[PlaylistWriter] persistWrittenPairs failed:', err);
    }
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

  // Retries fn up to MAX_ATTEMPTS times, only on RATE_LIMITED errors.
  // Uses exponential backoff with jitter. Never throws to caller.
  // Returns true when fn succeeded, false when all retries were exhausted or a
  // non-retryable error was encountered — lets the caller decide what to do with
  // persisted queue state.
  private async executeWithBackoff(fn: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await fn();
        return true;
      } catch (error) {
        const isRateLimited =
          error instanceof PlatformError && error.code === PlatformErrorCode.RATE_LIMITED;

        if (!isRateLimited) {
          // Non-retryable error — warn and exit immediately
          console.warn('[PlaylistWriter] Non-retryable error, aborting:', error);
          return false;
        }

        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        if (isLastAttempt) {
          console.warn('[PlaylistWriter] Max retry attempts reached after RATE_LIMITED:', error);
          return false;
        }

        // Exponential backoff: BASE_DELAY_MS * 2^attempt + random jitter up to 200ms
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  // Fires addToPlaylist for each destination in parallel — fire-and-forget (no await at call site).
  // Persists each entry to AsyncStorage before the network call so that a crash
  // between write() and the API response can be recovered via drainStoredQueue.
  // Skips destinations where the track was already successfully written (cross-session deduplication).
  write(trackId: string, destinationIds: string[]): void {
    const writes = destinationIds.map(async (playlistId) => {
      await this.ensureWrittenPairsLoaded();

      if (this.writtenPairs.has(this.pairKey(trackId, playlistId))) {
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
      });

      if (succeeded) {
        // 3a. Success — remove from durable queue and record so future swipes skip this pair.
        await this.removeFromQueue(trackId, playlistId);
        this.writtenPairs.add(this.pairKey(trackId, playlistId));
        void this.persistWrittenPairs();
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
      this.adapter.removeFromPlaylist(playlistId, trackId).then(() => {
        this.writtenPairs.delete(this.pairKey(trackId, playlistId));
        void this.persistWrittenPairs();
      }).catch((err: unknown) => {
        console.warn(`[PlaylistWriter] undoWrite failed for trackId=${trackId} playlistId=${playlistId}:`, err);
      });
    }
  }

  // Undo a super-like: removes from playlists we added to, and from library only if WE
  // added it (i.e. it was not already liked before the super-like).
  undoSuperLike(trackId: string, destinationIds: string[]): void {
    this.undoWrite(trackId, destinationIds);
    void (async () => {
      await this.ensureLibraryWrittenIdsLoaded();
      if (!this.libraryWrittenIds.has(trackId)) {
        return; // Pre-existing liked song — leave it in the library
      }
      try {
        await this.adapter.removeFromLibrary(trackId);
        this.libraryWrittenIds.delete(trackId);
        void this.persistLibraryWrittenIds();
      } catch (err: unknown) {
        if (err instanceof PlatformError && err.code === PlatformErrorCode.PERMISSION_DENIED) {
          console.warn('[PlaylistWriter] removeFromLibrary 403 — Spotify body:', err.message);
          return;
        }
        console.warn('[PlaylistWriter] removeFromLibrary failed:', err);
      }
    })();
  }

  // Super-like: writes to all destinations AND saves to library, both fire-and-forget.
  // Checks if the track is already liked before adding — if pre-existing, the library save
  // still fires (Spotify reorders it to the top) but the track is not recorded as "ours to
  // remove", so undoSuperLike will leave it in the library.
  superLike(trackId: string, destinationIds: string[]): void {
    this.write(trackId, destinationIds);
    void (async () => {
      await this.ensureLibraryWrittenIdsLoaded();
      if (this.libraryWrittenIds.has(trackId)) {
        return; // Already added by us — skip (deduplication, same as writtenPairs for playlists)
      }
      let preExisting = false;
      try {
        preExisting = await this.adapter.isInLibrary(trackId);
      } catch {
        // If the check fails, treat as new — better to add than silently skip
      }
      try {
        await this.adapter.saveToLibrary(trackId);
        if (!preExisting) {
          this.libraryWrittenIds.add(trackId);
          void this.persistLibraryWrittenIds();
        }
      } catch (error: unknown) {
        if (error instanceof PlatformError && error.code === PlatformErrorCode.PERMISSION_DENIED) {
          console.warn('[PlaylistWriter] saveToLibrary 403 — Spotify body:', error.message);
          return;
        }
        console.warn('[PlaylistWriter] saveToLibrary failed:', error);
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
      let succeeded = false;

      for (let attempt = entry.attempts; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          await adapter.addToPlaylist(entry.playlistId, entry.trackId);
          succeeded = true;
          break;
        } catch (error) {
          const isRateLimited =
            error instanceof PlatformError && error.code === PlatformErrorCode.RATE_LIMITED;

          if (!isRateLimited) {
            console.warn(
              `[PlaylistWriter] drainStoredQueue non-retryable error for trackId=${entry.trackId}:`,
              error,
            );
            break;
          }

          const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
          if (isLastAttempt) {
            console.warn(
              `[PlaylistWriter] drainStoredQueue exhausted retries for trackId=${entry.trackId}`,
            );
            break;
          }

          const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
      }

      if (!succeeded) {
        remaining.push({ ...entry, attempts: MAX_ATTEMPTS });
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
