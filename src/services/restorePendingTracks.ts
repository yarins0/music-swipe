import type { Track } from '@/adapters/interface';

// Maps the backend's GET /swipes restore payload to the internal Track type used
// by the swipe deck. The backend hydrates each restored swipe with a `track`
// object whose fields are snake_case (mirroring the `tracks` columns). The C1
// review finding was that the screen read a non-existent `metadata` field, so
// every restored card degenerated to the raw id. This module is the single,
// unit-tested place that maps that wire shape, guarding against future drift
// between the backend `TrackResponse` (backend/src/routes/trackResponse.ts) and
// the client.

/**
 * Track metadata as returned in the `track` field of GET /swipes.
 *
 * Field names mirror the backend `TrackResponse` (snake_case); keep this in
 * sync with backend/src/routes/trackResponse.ts.
 */
export interface RestoredTrackMetadata {
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

/**
 * One row from GET /swipes?status=pending. `track` is null when the backend has
 * no cached metadata for that track (the row was written before metadata sync).
 */
export interface PendingSwipeResponse {
  spotifyTrackId: string;
  track: RestoredTrackMetadata | null;
}

/**
 * Builds a display Track from a restored pending swipe.
 *
 * @param swipe       one GET /swipes row (id + hydrated track metadata, or null)
 * @param fallbackUri supplies the platform URI when no cached track row exists;
 *                    passed in so the platform-specific URI literal stays at the
 *                    UI/adapter boundary rather than in this business-logic module
 * @returns a Track with real metadata, or id-based fallbacks when uncached
 */
export function restoredSwipeToTrack(
  swipe: PendingSwipeResponse,
  fallbackUri: (trackId: string) => string,
): Track {
  const { spotifyTrackId, track } = swipe;
  return {
    id: spotifyTrackId,
    uri: track?.uri ?? fallbackUri(spotifyTrackId),
    title: track?.title ?? spotifyTrackId,
    artist: track?.artist ?? '',
    artists: track?.artists ?? (track?.artist ? [track.artist] : []),
    album: track?.album ?? '',
    albumArtUrl: track?.album_art_url ?? '',
    durationMs: track?.duration_ms ?? 0,
    previewUrl: track?.preview_url ?? null,
  };
}

/** Maps a full GET /swipes?status=pending response to restored Tracks. */
export function mapPendingSwipesToTracks(
  swipes: PendingSwipeResponse[],
  fallbackUri: (trackId: string) => string,
): Track[] {
  return swipes.map((swipe) => restoredSwipeToTrack(swipe, fallbackUri));
}
