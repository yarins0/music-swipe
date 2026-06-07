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
