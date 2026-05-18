import { extractSpotifyPlaylistId, getUserPlaylists } from '@/playlist/PlaylistResolver';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import type { MusicPlatformAdapter, Playlist } from '@/adapters/interface';

const makePlaylist = (overrides: Partial<Playlist>): Playlist => ({
  id: 'pl-default',
  name: 'Default Playlist',
  coverArtUrl: null,
  trackCount: 0,
  isOwned: false,
  isFollowed: false,
  ...overrides,
});

const likedSongs = makePlaylist({
  id: LIKED_SONGS_PLAYLIST_ID,
  name: 'Liked Songs',
  isOwned: true,
  isFollowed: false,
});

describe('extractSpotifyPlaylistId', () => {
  it('extracts ID from open.spotify.com playlist URL', () => {
    const id = extractSpotifyPlaylistId('https://open.spotify.com/playlist/37i9dQZF1DX5Vy6DFOcx00');
    expect(id).toBe('37i9dQZF1DX5Vy6DFOcx00');
  });

  it('extracts ID from spotify:playlist: URI', () => {
    const id = extractSpotifyPlaylistId('spotify:playlist:37i9dQZF1DX5Vy6DFOcx00');
    expect(id).toBe('37i9dQZF1DX5Vy6DFOcx00');
  });

  it('accepts a raw 22-character base62 ID', () => {
    const id = extractSpotifyPlaylistId('37i9dQZF1DX5Vy6DFOcx00');
    expect(id).toBe('37i9dQZF1DX5Vy6DFOcx00');
  });

  it('trims surrounding whitespace before matching a raw ID', () => {
    const id = extractSpotifyPlaylistId('  37i9dQZF1DX5Vy6DFOcx00  ');
    expect(id).toBe('37i9dQZF1DX5Vy6DFOcx00');
  });

  it('returns null for an invalid URL', () => {
    expect(extractSpotifyPlaylistId('https://example.com/foo')).toBeNull();
  });

  it('returns null for a short string that is not a valid ID', () => {
    expect(extractSpotifyPlaylistId('not-a-playlist')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractSpotifyPlaylistId('')).toBeNull();
  });
});

describe('getUserPlaylists', () => {
  it('places Liked Songs first in the owned list', async () => {
    const mockAdapter = {
      getUserPlaylists: jest.fn().mockResolvedValue([
        makePlaylist({ id: 'pl-a', name: 'Alpha', isOwned: true }),
        likedSongs,
        makePlaylist({ id: 'pl-b', name: 'Beta', isOwned: true }),
      ]),
    } as unknown as MusicPlatformAdapter;

    const { owned } = await getUserPlaylists(mockAdapter);
    expect(owned[0].id).toBe(LIKED_SONGS_PLAYLIST_ID);
  });

  it('separates followed playlists into the followed array', async () => {
    const mockAdapter = {
      getUserPlaylists: jest.fn().mockResolvedValue([
        likedSongs,
        makePlaylist({ id: 'pl-f', name: 'Followed Pl', isOwned: false, isFollowed: true }),
        makePlaylist({ id: 'pl-o', name: 'Owned Pl', isOwned: true, isFollowed: false }),
      ]),
    } as unknown as MusicPlatformAdapter;

    const { owned, followed } = await getUserPlaylists(mockAdapter);

    expect(owned.map((p) => p.id)).not.toContain('pl-f');
    expect(followed.map((p) => p.id)).toContain('pl-f');
    expect(followed.map((p) => p.id)).not.toContain('pl-o');
  });

  it('sorts owned playlists alphabetically after Liked Songs', async () => {
    const mockAdapter = {
      getUserPlaylists: jest.fn().mockResolvedValue([
        makePlaylist({ id: 'pl-c', name: 'Cello', isOwned: true }),
        likedSongs,
        makePlaylist({ id: 'pl-a', name: 'Alpha', isOwned: true }),
        makePlaylist({ id: 'pl-b', name: 'Beta', isOwned: true }),
      ]),
    } as unknown as MusicPlatformAdapter;

    const { owned } = await getUserPlaylists(mockAdapter);

    expect(owned[0].id).toBe(LIKED_SONGS_PLAYLIST_ID);
    expect(owned[1].name).toBe('Alpha');
    expect(owned[2].name).toBe('Beta');
    expect(owned[3].name).toBe('Cello');
  });

  it('sorts followed playlists alphabetically', async () => {
    const mockAdapter = {
      getUserPlaylists: jest.fn().mockResolvedValue([
        makePlaylist({ id: 'f2', name: 'Zeta', isFollowed: true }),
        makePlaylist({ id: 'f1', name: 'Appa', isFollowed: true }),
      ]),
    } as unknown as MusicPlatformAdapter;

    const { followed } = await getUserPlaylists(mockAdapter);
    expect(followed[0].name).toBe('Appa');
    expect(followed[1].name).toBe('Zeta');
  });
});
