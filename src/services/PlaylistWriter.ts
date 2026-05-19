import { MusicPlatformAdapter, PlatformError, PlatformErrorCode } from '../adapters/interface';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

export class PlaylistWriter {
  private readonly adapter: MusicPlatformAdapter;

  constructor(adapter: MusicPlatformAdapter) {
    this.adapter = adapter;
  }

  // Retries fn up to MAX_ATTEMPTS times, only on RATE_LIMITED errors.
  // Uses exponential backoff with jitter. Never throws to caller.
  private async executeWithBackoff(fn: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        const isRateLimited =
          error instanceof PlatformError && error.code === PlatformErrorCode.RATE_LIMITED;

        if (!isRateLimited) {
          // Non-retryable error — warn and exit immediately
          console.warn('[PlaylistWriter] Non-retryable error, aborting:', error);
          return;
        }

        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        if (isLastAttempt) {
          console.warn('[PlaylistWriter] Max retry attempts reached after RATE_LIMITED:', error);
          return;
        }

        // Exponential backoff: BASE_DELAY_MS * 2^attempt + random jitter up to 200ms
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Fires addToPlaylist for each destination in parallel — fire-and-forget (no await at call site).
  write(trackId: string, destinationIds: string[]): void {
    const writes = destinationIds.map((playlistId) =>
      this.executeWithBackoff(() => this.adapter.addToPlaylist(playlistId, trackId)),
    );
    // Intentionally not awaited — swipe UI must not be blocked
    void Promise.all(writes);
  }

  // Super-like: writes to all destinations AND saves to library, both fire-and-forget.
  superLike(trackId: string, destinationIds: string[]): void {
    this.write(trackId, destinationIds);
    this.adapter.saveToLibrary(trackId).catch((error: unknown) => {
      console.warn('[PlaylistWriter] saveToLibrary failed:', error);
    });
  }
}
