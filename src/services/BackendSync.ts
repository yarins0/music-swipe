/**
 * BackendSync handles fire-and-forget swipe posting and awaitable batch flushing
 * to the backend /swipes endpoint. The pending queue accumulates payloads from
 * postSwipe() calls and is drained by flushPending().
 */

import type { Track } from '@/adapters/interface';

export interface SwipePayload {
  sessionId: string;
  trackId: string;
  /** One of: liked | super_liked | skipped | pending */
  direction: 'liked' | 'super_liked' | 'skipped' | 'pending';
  destinationPlaylistIds: string[];
  timestamp: string;
  // Full track metadata for server-side restore (title/artist/art). Optional so
  // legacy/replayed payloads without it still post successfully; the client
  // always supplies it on live swipes.
  track?: Track;
  // True once PlaylistWriter confirms WE added this track to Liked Songs (not
  // pre-existing). Persisted so cancel-from-History can remove it from the
  // library after a clear + restore. Sent only when true (sticky-true server-side).
  likedSongsWrittenByUs?: boolean;
}

export class BackendSync {
  private readonly pending: SwipePayload[] = [];
  // Payloads currently being POSTed by an in-flight postSwipe() request.
  // flushPending() skips these so a batch flush cannot re-send a payload whose
  // single-element request is still settling (the M1 cleanup only removes a
  // payload from `pending` once its request resolves, leaving an in-flight
  // window where both paths could POST it). Tracked by reference identity, so
  // the same SwipePayload object pushed to `pending` is the key we add/remove.
  private readonly inFlight: Set<SwipePayload> = new Set();

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

    // Mark the payload in flight so a concurrent flushPending() skips it instead
    // of re-POSTing the same swipe.
    this.inFlight.add(payload);

    // Fire-and-forget: kick off a single-element flush immediately.
    // On success, remove the payload from pending so flushPending() does
    // not re-send it. On failure, leave it in pending so the next
    // flushPending() retries it. Either way, clear the in-flight mark once the
    // request settles so a later flush can retry a failed payload.
    this.sendBatch([payload]).then(() => {
      const index = this.pending.indexOf(payload);
      if (index !== -1) {
        this.pending.splice(index, 1);
      }
    }).catch((err: unknown) => {
      console.warn('[BackendSync] postSwipe failed:', err);
    }).finally(() => {
      this.inFlight.delete(payload);
    });
  }

  /**
   * Un-likes a previously-liked track (cancel-from-History): flips its server
   * swipe row to 'skipped' with no destinations. Because GET /sessions only
   * restores liked/super_liked rows, this stops the cancelled like from
   * re-hydrating into History on the next focus. Fire-and-forget — reuses the
   * postSwipe queue + retry path; no track metadata is needed for a skip.
   */
  unlikeSwipe(sessionId: string, trackId: string): void {
    this.postSwipe({
      sessionId,
      trackId,
      direction: 'skipped',
      destinationPlaylistIds: [],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Records that WE added a track to Liked Songs by re-posting its swipe with
   * likedSongsWrittenByUs=true. The library write confirms asynchronously after
   * the original swipe is posted, so this is a deferred update; the server keeps
   * the flag sticky-true regardless of arrival order. Fire-and-forget.
   */
  markLibraryWritten(args: {
    sessionId: string;
    trackId: string;
    direction: SwipePayload['direction'];
    destinationPlaylistIds: string[];
  }): void {
    this.postSwipe({
      sessionId: args.sessionId,
      trackId: args.trackId,
      direction: args.direction,
      destinationPlaylistIds: args.destinationPlaylistIds,
      timestamp: new Date().toISOString(),
      likedSongsWrittenByUs: true,
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

    // Drain only payloads that are NOT already being sent by an in-flight
    // postSwipe(). In-flight payloads stay in `pending` so their own request
    // can clean them up on success or leave them for a later retry on failure;
    // pulling them here would double-send the same swipe.
    const batch: SwipePayload[] = [];
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const payload = this.pending[index];
      if (this.inFlight.has(payload)) {
        continue;
      }
      this.pending.splice(index, 1);
      batch.unshift(payload);
    }

    // Nothing flushable right now — every pending payload is mid-flight.
    if (batch.length === 0) {
      return;
    }

    try {
      await this.sendBatch(batch);
    } catch (err) {
      // Restore the batch on failure (e.g. a network blip during the session-end
      // flush) so those swipes are retried on the next flush instead of being
      // dropped. Unshift keeps the older batch ahead of any payloads that arrived
      // while the request was in flight, preserving chronological order.
      this.pending.unshift(...batch);
      throw err;
    }
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
      // Nest the track metadata only when present so no-track payloads keep
      // their exact shape (the backend treats `track` as optional).
      ...(p.track
        ? {
            track: {
              uri: p.track.uri,
              title: p.track.title,
              artist: p.track.artist,
              artists: p.track.artists,
              album: p.track.album,
              albumArtUrl: p.track.albumArtUrl,
              durationMs: p.track.durationMs,
              previewUrl: p.track.previewUrl,
            },
          }
        : {}),
      // Send the flag only when true so plain swipes keep their exact prior shape
      // (the backend defaults it to false and keeps it sticky-true on conflict).
      ...(p.likedSongsWrittenByUs ? { likedSongsWrittenByUs: true } : {}),
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
