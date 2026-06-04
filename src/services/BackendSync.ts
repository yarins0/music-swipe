/**
 * BackendSync handles fire-and-forget swipe posting and awaitable batch flushing
 * to the backend /swipes endpoint. The pending queue accumulates payloads from
 * postSwipe() calls and is drained by flushPending().
 */

export interface SwipePayload {
  sessionId: string;
  trackId: string;
  /** One of: liked | super_liked | skipped | pending */
  direction: 'liked' | 'super_liked' | 'skipped' | 'pending';
  destinationPlaylistIds: string[];
  timestamp: string;
}

export class BackendSync {
  private readonly pending: SwipePayload[] = [];

  constructor(
    private readonly backendUrl: string,
    private readonly getToken: () => string,
  ) {}

  /**
   * Enqueues a single swipe and fires it toward the backend without awaiting.
   * Errors are only logged — they must not block the swipe UI.
   */
  postSwipe(payload: SwipePayload): void {
    this.pending.push(payload);

    // Fire-and-forget: kick off a single-element flush immediately.
    // On success, remove the payload from pending so flushPending() does
    // not re-send it. On failure, leave it in pending so the next
    // flushPending() retries it.
    this.sendBatch([payload]).then(() => {
      const index = this.pending.indexOf(payload);
      if (index !== -1) {
        this.pending.splice(index, 1);
      }
    }).catch((err: unknown) => {
      console.warn('[BackendSync] postSwipe failed:', err);
    });
  }

  /**
   * Sends all pending payloads in a single batch request.
   * Resolves when the server responds with 2xx; rejects on HTTP or network errors.
   * Is a no-op (resolves immediately) when the queue is empty.
   */
  async flushPending(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }

    // Drain the queue snapshot before awaiting so new postSwipe() calls
    // that arrive concurrently do not get swallowed by this flush.
    const batch = this.pending.splice(0, this.pending.length);

    await this.sendBatch(batch);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async sendBatch(payloads: SwipePayload[]): Promise<void> {
    const swipes = payloads.map((p) => ({
      sessionId: p.sessionId,
      spotifyTrackId: p.trackId,
      status: p.direction,
      destinationPlaylistIds: p.destinationPlaylistIds,
    }));

    const response = await fetch(`${this.backendUrl}/swipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.getToken()}`,
      },
      body: JSON.stringify({ swipes }),
    });

    if (!response.ok) {
      throw new Error(`BackendSync.sendBatch failed: ${response.status}`);
    }
  }
}
