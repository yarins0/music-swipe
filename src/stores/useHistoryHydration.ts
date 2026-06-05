import { useCallback } from 'react';
import type { Track } from '@/adapters/interface';
import { BACKEND_URL } from '@/config';
import { useAuthStore } from '@/stores/authStore';
import { useSwipeStore } from '@/stores/swipeStore';
import type { SessionEntry, SessionStatus, SwipeRecord, SwipeStatus } from '@/stores/sessionTypes';

// Shape of the nested track object returned by GET /sessions (mirrors the
// backend's TrackResponse — snake_case columns plus an `id` alias).
interface RemoteTrack {
  id: string;
  spotify_track_id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string | null;
  album_art_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  uri: string | null;
}

interface RemoteLikedSwipe {
  id: string;
  spotifyTrackId: string;
  status: string;
  swipedAt: string;
  destinationPlaylistIds: string[];
  track: RemoteTrack | null;
}

interface RemoteSession {
  sessionId: string;
  sourcePlaylistId: string;
  sourcePlaylistName: string | null;
  destinationPlaylistIds: string[];
  destinationPlaylistNames: string[];
  isFilterMode: boolean;
  resumeOffset: number;
  totalTracks: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  swipedCount: number;
  likedCount: number;
  superLikedCount: number;
  likedSwipes: RemoteLikedSwipe[];
}

interface SessionListResponse {
  sessions: RemoteSession[];
}

interface UseHistoryHydrationResult {
  hydrate: () => Promise<void>;
}

/** Map the backend's nested track object to the client's internal Track shape. */
function toClientTrack(remote: RemoteTrack): Track {
  return {
    id: remote.id,
    uri: remote.uri ?? '',
    title: remote.title,
    artist: remote.artist,
    artists: remote.artists,
    album: remote.album ?? '',
    albumArtUrl: remote.album_art_url ?? '',
    durationMs: remote.duration_ms ?? 0,
    previewUrl: remote.preview_url,
  };
}

/**
 * Convert one remote liked swipe to a SwipeRecord, or null when it carries no
 * track metadata (an un-renderable row that must be dropped, not restored).
 */
function toSwipeRecord(remote: RemoteLikedSwipe, sessionId: string): SwipeRecord | null {
  if (remote.track === null) return null;
  return {
    id: remote.id,
    track: toClientTrack(remote.track),
    status: remote.status as SwipeStatus,
    destinationPlaylistIds: remote.destinationPlaylistIds,
    swipedAt: remote.swipedAt,
    sessionId,
  };
}

/** Convert one remote session row to the client's SessionEntry shape. */
function toSessionEntry(remote: RemoteSession): SessionEntry {
  const likedSwipes = remote.likedSwipes
    .map((swipe) => toSwipeRecord(swipe, remote.sessionId))
    .filter((record): record is SwipeRecord => record !== null);

  return {
    sessionId: remote.sessionId,
    sourcePlaylistId: remote.sourcePlaylistId,
    sourcePlaylistName: remote.sourcePlaylistName ?? '',
    destinationPlaylistIds: remote.destinationPlaylistIds,
    destinationPlaylistNames: remote.destinationPlaylistNames,
    isFilterMode: remote.isFilterMode,
    resumeOffset: remote.resumeOffset,
    totalTracks: remote.totalTracks,
    status: remote.status as SessionStatus,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    swipedCount: remote.swipedCount,
    likedCount: remote.likedCount,
    superLikedCount: remote.superLikedCount,
    likedSwipes,
  };
}

/**
 * Fetches the server's session history and merges it into the local store, so
 * History survives reinstalls and travels across devices. Best-effort: a missing
 * token or a failed request is logged and swallowed, leaving the local cache
 * (stale-while-revalidate) intact. Intended to be called on History tab focus.
 */
export function useHistoryHydration(): UseHistoryHydrationResult {
  const mergeRemoteSessions = useSwipeStore((state) => state.mergeRemoteSessions);

  const hydrate = useCallback(async (): Promise<void> => {
    const token = useAuthStore.getState().supabaseToken;
    if (!token) return;

    try {
      const response = await fetch(`${BACKEND_URL}/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`useHistoryHydration failed: ${response.status}`);
      }

      const data = (await response.json()) as SessionListResponse;
      const remoteSessions = data.sessions.map(toSessionEntry);
      mergeRemoteSessions(remoteSessions);
    } catch (err) {
      console.warn('[useHistoryHydration] hydrate failed:', err);
    }
  }, [mergeRemoteSessions]);

  return { hydrate };
}
