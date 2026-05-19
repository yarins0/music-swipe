/**
 * SessionTracker manages the lifecycle of a swipe session against the backend API.
 * openSession creates the session and returns its id.
 * closeSession and incrementCounts are fire-and-forget — they do not block the swipe UI.
 */
export class SessionTracker {
  constructor(
    private readonly backendUrl: string,
    private readonly token: string,
  ) {}

  /**
   * Creates a new session for the given source playlist.
   * destinationPlaylistIds is stored locally by callers — the backend /sessions endpoint
   * does not accept it, but it is part of the public surface so callers can pass it through.
   * Throws a descriptive error when the server responds with a non-2xx status.
   */
  async openSession(playlistId: string, _destinationPlaylistIds: string[] = []): Promise<string> {
    const response = await fetch(`${this.backendUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ sourcePlaylistId: playlistId }),
    });

    if (!response.ok) {
      throw new Error(`openSession failed: ${response.status}`);
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  /**
   * Marks the session as ended. Fire-and-forget — errors are only logged.
   */
  closeSession(sessionId: string): void {
    fetch(`${this.backendUrl}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    }).catch((err: unknown) => {
      console.warn('SessionTracker.closeSession failed:', err);
    });
  }

  /**
   * Increments swipe-count fields for a session.
   * Only fields with a non-zero delta value are included in the PATCH body.
   * Fire-and-forget — errors are only logged.
   */
  incrementCounts(
    sessionId: string,
    delta: { liked?: number; skipped?: number; superLiked?: number },
  ): void {
    const body: Record<string, number> = {};

    if (delta.liked) {
      body['likedCount'] = delta.liked;
    }
    if (delta.skipped) {
      body['swipedCount'] = delta.skipped;
    }
    if (delta.superLiked) {
      body['superLikedCount'] = delta.superLiked;
    }

    if (Object.keys(body).length === 0) {
      return;
    }

    fetch(`${this.backendUrl}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    }).catch((err: unknown) => {
      console.warn('SessionTracker.incrementCounts failed:', err);
    });
  }
}
