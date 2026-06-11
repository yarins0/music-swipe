import { useMemo } from 'react';
import { useSwipeStore } from '@/stores/swipeStore';
import type { Track } from '@/adapters/interface';

export interface MatchRecord {
  id: string;
  track: Track;
  status: 'liked' | 'super_liked';
  destinationPlaylistIds: string[];
  destinationPlaylistNames?: string[];
  swipedAt: string;
  sessionId?: string;
  sourcePlaylistName?: string;
  likedSongsWrittenByUs?: boolean;
}

interface UseMatchesStoreResult {
  matches: MatchRecord[];
  isLoading: false;
}

export function useMatchesStore(): UseMatchesStoreResult {
  const sessions = useSwipeStore((state) => state.sessions);

  // Flatten liked tracks across every session, most-recent session + most-recent track first.
  // Memoized on `sessions` so the array identity is stable between unrelated store updates,
  // letting downstream React.memo consumers skip re-renders.
  const matches: MatchRecord[] = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .flatMap((session) =>
          [...session.likedSwipes].reverse().map((record) => ({
            id: record.id,
            track: record.track,
            status: record.status as 'liked' | 'super_liked',
            destinationPlaylistIds: record.destinationPlaylistIds,
            destinationPlaylistNames: record.destinationPlaylistNames,
            swipedAt: record.swipedAt,
            sessionId: record.sessionId,
            sourcePlaylistName: record.sourcePlaylistName,
            likedSongsWrittenByUs: record.likedSongsWrittenByUs,
          })),
        ),
    [sessions],
  );

  return { matches, isLoading: false };
}

interface BackendSwipeItem {
  id: string;
  track_id: string;
  status: string;
  destination_playlist_ids: string[];
  swiped_at: string;
  track?: {
    id: string;
    uri: string;
    title: string;
    artist: string;
    artists: string[];
    album: string;
    album_art_url: string;
    duration_ms: number;
    preview_url: string | null;
  };
}

/**
 * Standalone async function (not a hook) used as a fallback after clearSession()
 * has been called and Zustand state is gone.
 */
export async function fetchFromBackend(
  sessionId: string,
  token: string,
  backendUrl: string,
): Promise<MatchRecord[]> {
  // No status filter: GET /swipes validates a single status value and rejects comma lists, so we
  // fetch all of the session's swipes and filter to liked/super_liked client-side below.
  const url = `${backendUrl}/swipes?session_id=${encodeURIComponent(sessionId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`fetchFromBackend failed: ${response.status}`);
  }

  const data: { swipes: BackendSwipeItem[] } = await response.json();

  return data.swipes
    .filter(
      (item): item is BackendSwipeItem & { status: 'liked' | 'super_liked' } =>
        item.status === 'liked' || item.status === 'super_liked',
    )
    .map((item) => ({
      id: item.id,
      track: {
        id: item.track?.id ?? item.track_id,
        uri: item.track?.uri ?? '',
        title: item.track?.title ?? '',
        artist: item.track?.artist ?? '',
        artists: item.track?.artists ?? [],
        album: item.track?.album ?? '',
        albumArtUrl: item.track?.album_art_url ?? '',
        durationMs: item.track?.duration_ms ?? 0,
        previewUrl: item.track?.preview_url ?? null,
      },
      status: item.status,
      destinationPlaylistIds: item.destination_playlist_ids,
      swipedAt: item.swiped_at,
    }));
}
