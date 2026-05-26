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
  images: SpotifyImage[] | null;
}

interface SpotifyTrackObject {
  id: string;
  uri: string;
  name: string;
  type: string;
  artists: SpotifyArtist[] | null;
  album: SpotifyAlbum | null;
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
  images: SpotifyImage[] | null;
  owner: SpotifyPlaylistOwner;
  items?: { total: number };   // current field (Spotify API)
}

export function mapSpotifyTrack(item: SpotifyTrackItem): Track {
  const t = item.item ?? item.track;
  if (!t) throw new Error('SpotifyTrackItem has no track or item field');
  const artists = t.artists ?? [];
  const albumImages = t.album?.images ?? [];
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: artists[0]?.name ?? 'Unknown Artist',
    artists: artists.map((a) => a.name),
    album: t.album?.name ?? '',
    albumArtUrl: albumImages[0]?.url ?? '',
    durationMs: t.duration_ms,
    previewUrl: t.preview_url,
  };
}

export function mapSpotifyPlaylist(
  item: SpotifyPlaylistItem,
  currentUserId: string,
): Playlist {
  const images = item.images ?? [];
  return {
    id: item.id,
    name: item.name,
    coverArtUrl: images[0]?.url ?? null,
    trackCount: item.items?.total ?? 0,
    isOwned: item.owner.id === currentUserId,
    isFollowed: item.owner.id !== currentUserId,
  };
}
