import type { Track } from '@/adapters/interface';

/**
 * Outcome of a single swipe. `pending` is a decide-later deferral; the rest are terminal.
 */
export type SwipeStatus = 'liked' | 'super_liked' | 'skipped' | 'pending';

/**
 * One recorded swipe. Stored both in the active session's `likedSwipes` (liked/super_liked
 * only, for History + session-end display) and transiently in `pendingSyncSwipes` (the
 * backend sync buffer).
 */
export interface SwipeRecord {
  // Stable per-record identity used for undo/remove/React keys. Sourced from the backend
  // swipe id once synced/hydrated, or a client-generated UUID at creation for not-yet-synced
  // records. Replaces the former swipedAt-as-identity (which collides on shared timestamps).
  id: string;
  track: Track;
  status: SwipeStatus;
  destinationPlaylistIds: string[];
  destinationPlaylistNames?: string[];
  swipedAt: string; // ISO timestamp — display/order only; no longer the record identity
  sessionId?: string;
  sourcePlaylistName?: string;
  // Set to true only after PlaylistWriter confirms the track was added to Liked Songs
  // by us in this session (not pre-existing). Used by history/session-end to guard
  // library removal without relying on cross-session AsyncStorage state.
  likedSongsWrittenByUs?: boolean;
}

/**
 * `active` while the session is resumable; `completed` once its queue has been exhausted.
 * Completed entries remain in History as read-only summary cards.
 */
export type SessionStatus = 'active' | 'completed';

/**
 * A durable, self-contained record of one swipe session. This is the unit held in the
 * History stack and the unit a session resumes from. It is intentionally JSON-serializable
 * and shaped to mirror a future `sessions` DB row, so a server-backed
 * SessionHistoryRepository can persist/restore the exact same fields later.
 *
 * The `sessions` table mirrors these fields (source_playlist_name, destination_playlist_ids[],
 * destination_playlist_names[], resume_offset, status, updated_at) and `GET /sessions` returns
 * them, so History restores across devices/reinstalls. The local stack (AsyncStorage via the
 * persist middleware) is a stale-while-revalidate cache hydrated from the server on focus.
 */
export interface SessionEntry {
  sessionId: string;                  // backend session id (from POST /sessions)
  sourcePlaylistId: string;
  sourcePlaylistName: string;
  destinationPlaylistIds: string[];
  destinationPlaylistNames: string[];
  isFilterMode: boolean;
  resumeOffset: number;               // playlist tracks consumed; where a resume re-fetches from
  totalTracks: number;
  status: SessionStatus;
  createdAt: string;                  // ISO
  updatedAt: string;                  // ISO — drives most-recent-first ordering
  swipedCount: number;
  likedCount: number;
  superLikedCount: number;
  likedSwipes: SwipeRecord[];         // liked + super_liked only — History expansion + session-end
}

/** Maximum number of sessions retained in the History stack. Oldest are evicted past this. */
export const MAX_SESSION_HISTORY = 10;

/** A session is resumable while it is still active and has playlist tracks left to show. */
export function isResumable(entry: SessionEntry): boolean {
  return entry.status === 'active' && entry.resumeOffset < entry.totalTracks;
}
