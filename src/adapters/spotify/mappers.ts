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
  track?: SpotifyTrackObject | null;
  item?: SpotifyTrackObject | null;
  added_at?: string;
  is_local?: boolean;
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
  items?: { total: number };   // current field (Spotify API)
}

export function mapSpotifyTrack(item: SpotifyTrackItem): Track {
  const t = item.item ?? item.track;
  if (!t) throw new Error('SpotifyTrackItem has no track or item field');
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
    trackCount: item.items?.total ?? 0,
    isOwned: item.owner.id === currentUserId,
    isFollowed: item.owner.id !== currentUserId,
  };
}
