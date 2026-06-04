/**
 * SessionTracker manages the lifecycle of a swipe session against the backend API.
 * openSession creates the session and returns its id.
 * closeSession is fire-and-forget — it does not block the swipe UI.
 */
export class SessionTracker {
  constructor(
    private readonly backendUrl: string,
    private readonly getToken: () => string,
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
        Authorization: `Bearer ${this.getToken()}`,
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
        Authorization: `Bearer ${this.getToken()}`,
      },
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    }).catch((err: unknown) => {
      console.warn('SessionTracker.closeSession failed:', err);
    });
  }

}
