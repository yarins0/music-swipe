// Shared shape + mapper for track metadata in API responses.
//
// Both GET /swipes and GET /sessions hydrate liked tracks from the `tracks`
// table. They return the same object so the client has one mapping to maintain.
// Fields stay snake_case (matching the column names) except `id`, which is set
// to spotify_track_id to match the client's Track.id semantics.

/** A `tracks` row as selected by the restore queries. */
export interface TrackRow {
  spotify_track_id: string;
  title: string;
  artist: string;
  artists: string[] | null;
  album: string | null;
  album_art_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  uri: string | null;
}

/** The track object returned to the client (snake_case + an `id` alias). */
export interface TrackResponse {
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

/** The columns the restore queries must select from `tracks`. */
export const TRACK_SELECT =
  'spotify_track_id, title, artist, artists, album, album_art_url, duration_ms, preview_url, uri';

/** Map a `tracks` row to the client-facing response object. */
export function toTrackResponse(row: TrackRow): TrackResponse {
  return {
    id: row.spotify_track_id,
    spotify_track_id: row.spotify_track_id,
    title: row.title,
    artist: row.artist,
    artists: row.artists ?? [],
    album: row.album,
    album_art_url: row.album_art_url,
    duration_ms: row.duration_ms,
    preview_url: row.preview_url,
    uri: row.uri,
  };
}

/** Build a spotify_track_id → TrackResponse map from a set of fetched rows. */
export function buildTracksById(rows: TrackRow[]): Map<string, TrackResponse> {
  const tracksById = new Map<string, TrackResponse>();
  for (const row of rows) {
    tracksById.set(row.spotify_track_id, toTrackResponse(row));
  }
  return tracksById;
}
