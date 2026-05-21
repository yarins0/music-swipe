import { mapSpotifyTrack, mapSpotifyPlaylist } from '../../spotify/mappers';

describe('mapSpotifyTrack', () => {
  const baseItem = {
    track: {
      id: 'track-1',
      uri: 'spotify:track:track-1',
      name: 'Test Song',
      artists: [
        { id: 'a1', name: 'Artist One' },
        { id: 'a2', name: 'Artist Two' },
      ],
      album: {
        name: 'Test Album',
        images: [{ url: 'http://img.test', height: 300, width: 300 }],
      },
      duration_ms: 180000,
      preview_url: 'http://preview.test',
    },
  };

  it('maps id, uri, and title correctly', () => {
    const track = mapSpotifyTrack(baseItem);
    expect(track.id).toBe('track-1');
    expect(track.uri).toBe('spotify:track:track-1');
    expect(track.title).toBe('Test Song');
  });

  it('sets artist to the first artist name', () => {
    const track = mapSpotifyTrack(baseItem);
    expect(track.artist).toBe('Artist One');
  });

  it('sets artists as an array of all artist names', () => {
    const track = mapSpotifyTrack(baseItem);
    expect(track.artists).toEqual(['Artist One', 'Artist Two']);
  });

  it('maps durationMs from duration_ms', () => {
    const track = mapSpotifyTrack(baseItem);
    expect(track.durationMs).toBe(180000);
  });

  it('uses first image url for albumArtUrl', () => {
    const track = mapSpotifyTrack(baseItem);
    expect(track.albumArtUrl).toBe('http://img.test');
  });

  it('falls back to empty string for albumArtUrl when images is empty', () => {
    const item = {
      ...baseItem,
      track: { ...baseItem.track, album: { name: 'Album', images: [] } },
    };
    const track = mapSpotifyTrack(item);
    expect(track.albumArtUrl).toBe('');
  });

  it('passes through previewUrl including null', () => {
    const item = { ...baseItem, track: { ...baseItem.track, preview_url: null } };
    const track = mapSpotifyTrack(item);
    expect(track.previewUrl).toBeNull();
  });
});

describe('mapSpotifyPlaylist', () => {
  const baseItem = {
    id: 'playlist-1',
    name: 'My Playlist',
    images: [{ url: 'http://cover.test', height: 300, width: 300 }],
    owner: { id: 'user-1', display_name: 'User One' },
    items: { total: 42 },
  };

  it('sets isOwned = true when owner.id matches currentUserId', () => {
    const playlist = mapSpotifyPlaylist(baseItem, 'user-1');
    expect(playlist.isOwned).toBe(true);
    expect(playlist.isFollowed).toBe(false);
  });

  it('sets isOwned = false and isFollowed = true when owner differs', () => {
    const playlist = mapSpotifyPlaylist(baseItem, 'different-user');
    expect(playlist.isOwned).toBe(false);
    expect(playlist.isFollowed).toBe(true);
  });

  it('maps id, name, and trackCount', () => {
    const playlist = mapSpotifyPlaylist(baseItem, 'user-1');
    expect(playlist.id).toBe('playlist-1');
    expect(playlist.name).toBe('My Playlist');
    expect(playlist.trackCount).toBe(42);
  });

  it('uses first image url for coverArtUrl', () => {
    const playlist = mapSpotifyPlaylist(baseItem, 'user-1');
    expect(playlist.coverArtUrl).toBe('http://cover.test');
  });

  it('returns null for coverArtUrl when images is empty', () => {
    const item = { ...baseItem, images: [] };
    const playlist = mapSpotifyPlaylist(item, 'user-1');
    expect(playlist.coverArtUrl).toBeNull();
  });
});
