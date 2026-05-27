import type { MusicPlatformAdapter, Playlist } from '@/adapters/interface';
import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';

export interface PlaylistSections {
  owned: Playlist[];
  followed: Playlist[];
}

export async function getUserPlaylists(
  adapter: MusicPlatformAdapter,
): Promise<PlaylistSections> {
  const all = await adapter.getUserPlaylists();

  const owned = all.filter((p) => p.isOwned).sort((a, b) => {
    // Liked Songs always first
    if (a.id === LIKED_SONGS_PLAYLIST_ID) return -1;
    if (b.id === LIKED_SONGS_PLAYLIST_ID) return 1;
    return a.name.localeCompare(b.name);
  });

  // Exclude owned playlists — Spotify marks them as both isOwned and isFollowed,
  // which would produce duplicate IDs across the two SectionList sections.
  const followed = all
    .filter((p) => p.isFollowed && !p.isOwned)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { owned, followed };
}

const SPOTIFY_PLAYLIST_URL_RE = /spotify\.com\/playlist\/([a-zA-Z0-9]+)/;
const SPOTIFY_URI_RE = /^spotify:playlist:([a-zA-Z0-9]+)$/;
const SPOTIFY_RAW_ID_RE = /^[a-zA-Z0-9]{22}$/;

export function extractSpotifyPlaylistId(input: string): string | null {
  const urlMatch = input.match(SPOTIFY_PLAYLIST_URL_RE);
  if (urlMatch) return urlMatch[1];

  const uriMatch = input.match(SPOTIFY_URI_RE);
  if (uriMatch) return uriMatch[1];

  if (SPOTIFY_RAW_ID_RE.test(input.trim())) return input.trim();

  return null;
}

export async function resolvePlaylistFromUrl(
  input: string,
  adapter: MusicPlatformAdapter,
): Promise<Playlist> {
  const playlistId = extractSpotifyPlaylistId(input.trim());

  if (!playlistId) {
    throw new Error('Invalid Spotify playlist URL or ID');
  }

  try {
    return await adapter.getPlaylistById(playlistId);
  } catch (err) {
    if (err instanceof PlatformError && err.code === PlatformErrorCode.NOT_FOUND) {
      throw new Error('Playlist not found or private');
    }
    throw err;
  }
}

// Stub — implemented in Phase 2 when backend swipe data is available
export async function getPendingTracks(
  _playlistId: string,
  _userId: string,
  _adapter: MusicPlatformAdapter,
): Promise<[]> {
  return [];
}
