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

export class PlaylistWriter {
  private readonly adapter: MusicPlatformAdapter;
  private readonly storage: StorageInterface;

  constructor(adapter: MusicPlatformAdapter, storage: StorageInterface = AsyncStorageDefault) {
    this.adapter = adapter;
    this.storage = storage;
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
  write(trackId: string, destinationIds: string[]): void {
    const writes = destinationIds.map(async (playlistId) => {
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
        // 3a. Success — remove from durable queue so it is not re-attempted on next launch.
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

  // Super-like: writes to all destinations AND saves to library, both fire-and-forget.
  superLike(trackId: string, destinationIds: string[]): void {
    this.write(trackId, destinationIds);
    this.adapter.saveToLibrary(trackId).catch((error: unknown) => {
      console.warn('[PlaylistWriter] saveToLibrary failed:', error);
    });
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
