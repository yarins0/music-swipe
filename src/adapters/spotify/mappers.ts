import type { Track, Playlist } from '../interface';

interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

interface SpotifyArtist {
  id: string;
  name: string;
}

interface SpotifyAlbum {
  name: string;
  images: SpotifyImage[];
}

interface SpotifyTrackObject {
  id: string;
  uri: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  duration_ms: number;
  preview_url: string | null;
}

export interface SpotifyTrackItem {
  track: SpotifyTrackObject;
  added_at?: string;
}

interface SpotifyPlaylistOwner {
  id: string;
  display_name: string | null;
}

export interface SpotifyPlaylistItem {
  id: string;
  name: string;
  images: SpotifyImage[];
  owner: SpotifyPlaylistOwner;
  tracks: { total: number };
}

export function mapSpotifyTrack(item: SpotifyTrackItem): Track {
  const t = item.track;
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: t.artists[0]?.name ?? 'Unknown Artist',
    artists: t.artists.map((a) => a.name),
    album: t.album.name,
    albumArtUrl: t.album.images[0]?.url ?? '',
    durationMs: t.duration_ms,
    previewUrl: t.preview_url,
  };
}

export function mapSpotifyPlaylist(
  item: SpotifyPlaylistItem,
  currentUserId: string,
): Playlist {
  return {
    id: item.id,
    name: item.name,
    coverArtUrl: item.images[0]?.url ?? null,
    trackCount: item.tracks.total,
    isOwned: item.owner.id === currentUserId,
    isFollowed: item.owner.id !== currentUserId,
  };
}
