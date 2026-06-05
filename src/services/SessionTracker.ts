import type { SessionStatus } from '@/stores/sessionTypes';

/**
 * Optional session metadata sent on creation so a restored History card can be
 * rebuilt server-side (names, destinations, filter mode, track total). All fields
 * are optional for backward compatibility — callers that omit them fall back to
 * the backend column defaults.
 */
export interface SessionMeta {
  sourcePlaylistName?: string;
  destinationPlaylistNames?: string[];
  isFilterMode?: boolean;
  totalTracks?: number;
}

/**
 * Fields updatable on an existing session via PATCH /sessions/:id. Used to flush
 * resume progress and final status to the server at session end (not per-swipe).
 */
export interface SessionPatch {
  resumeOffset?: number;
  status?: SessionStatus;
  endedAt?: string;
  totalTracks?: number;
  sourcePlaylistName?: string;
  destinationPlaylistIds?: string[];
  destinationPlaylistNames?: string[];
  isFilterMode?: boolean;
}

/**
 * SessionTracker manages the lifecycle of a swipe session against the backend API.
 * openSession creates the session and returns its id.
 * closeSession / updateSession are fire-and-forget — they do not block the swipe UI.
 */
export class SessionTracker {
  constructor(
    private readonly backendUrl: string,
    private readonly getToken: () => string,
  ) {}

  /**
   * Creates a new session for the given source playlist.
   * destinationPlaylistIds is now sent to the backend (previously local-only) so a
   * restored session knows where its likes were routed. `meta` carries the remaining
   * SessionEntry fields; each is forwarded only when provided so the backend's
   * minimal-insert defaults still apply for callers that omit them.
   * Throws a descriptive error when the server responds with a non-2xx status.
   */
  async openSession(
    playlistId: string,
    destinationPlaylistIds: string[] = [],
    meta?: SessionMeta,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      sourcePlaylistId: playlistId,
      destinationPlaylistIds,
    };
    if (meta?.sourcePlaylistName !== undefined) {
      body['sourcePlaylistName'] = meta.sourcePlaylistName;
    }
    if (meta?.destinationPlaylistNames !== undefined) {
      body['destinationPlaylistNames'] = meta.destinationPlaylistNames;
    }
    if (meta?.isFilterMode !== undefined) body['isFilterMode'] = meta.isFilterMode;
    if (meta?.totalTracks !== undefined) body['totalTracks'] = meta.totalTracks;

    const response = await fetch(`${this.backendUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.getToken()}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`openSession failed: ${response.status}`);
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  /**
   * Persists resume progress / status (or any SessionPatch field) to the server.
   * Fire-and-forget — errors are only logged. Called at session end to flush the
   * final resumeOffset + completed status, deliberately not on every swipe.
   */
  updateSession(sessionId: string, patch: SessionPatch): void {
    fetch(`${this.backendUrl}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.getToken()}`,
      },
      body: JSON.stringify(patch),
    }).catch((err: unknown) => {
      console.warn('SessionTracker.updateSession failed:', err);
    });
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
