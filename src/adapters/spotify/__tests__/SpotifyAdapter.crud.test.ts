import { SpotifyAdapter } from '../SpotifyAdapter';
import { PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '../../interface';
import { spotifyFetch } from '../spotifyFetch';

jest.mock('../spotifyFetch');

const mockSpotifyFetch = spotifyFetch as jest.MockedFunction<typeof spotifyFetch>;

const makeAuth = () => ({
  accessToken: 'test-token',
  refreshToken: 'test-refresh',
  expiresAt: Date.now() + 60 * 60 * 1000,
  onTokenRefreshed: jest.fn(),
  onAuthExpired: jest.fn(),
});

const makeMeResponse = () => ({ id: 'user-123', display_name: 'Test User', email: 'test@test.com' });

const makePlaylistItem = (id: string) => ({
  id,
  name: `Playlist ${id}`,
  images: [{ url: `http://cover.test/${id}`, height: 300, width: 300 }],
  owner: { id: 'user-123', display_name: 'Test User' },
  items: { total: 10 },
});

const makeTrackItem = (id: string) => ({
  track: {
    id,
    uri: `spotify:track:${id}`,
    name: `Track ${id}`,
    type: 'track',
    artists: [{ id: 'a1', name: 'Artist One' }],
    album: { name: 'Album', images: [{ url: 'http://art.test', height: 300, width: 300 }] },
    duration_ms: 180000,
    preview_url: null,
  },
});

describe('SpotifyAdapter — CRUD', () => {
  let adapter: SpotifyAdapter;

  beforeEach(() => {
    jest.resetAllMocks();
    adapter = new SpotifyAdapter(makeAuth());
  });

  // --- getUserId ---

  it('getUserId() fetches /me and returns the user id', async () => {
    mockSpotifyFetch.mockResolvedValueOnce(makeMeResponse());

    const id = await adapter.getUserId();

    expect(id).toBe('user-123');
    expect(mockSpotifyFetch).toHaveBeenCalledWith('/me', {}, expect.anything());
  });

  it('getUserId() caches the result and does not call /me a second time', async () => {
    mockSpotifyFetch.mockResolvedValueOnce(makeMeResponse());

    await adapter.getUserId();
    await adapter.getUserId();

    expect(mockSpotifyFetch).toHaveBeenCalledTimes(1);
  });

  // --- getUserPlaylists ---

  it('getUserPlaylists() returns Liked Songs as the first item', async () => {
    // getUserId
    mockSpotifyFetch.mockResolvedValueOnce(makeMeResponse());
    // /me/playlists page 1 (no next)
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makePlaylistItem('pl-1')],
      next: null,
      total: 1,
    });
    // /me/tracks?limit=1 for liked count
    mockSpotifyFetch.mockResolvedValueOnce({ total: 99 });

    const playlists = await adapter.getUserPlaylists();

    expect(playlists[0].id).toBe(LIKED_SONGS_PLAYLIST_ID);
    expect(playlists[0].name).toBe('Liked Songs');
    expect(playlists[0].trackCount).toBe(99);
  });

  it('getUserPlaylists() paginates through all pages', async () => {
    mockSpotifyFetch.mockResolvedValueOnce(makeMeResponse());
    // Page 1 with a next pointer
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makePlaylistItem('pl-1')],
      next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
      total: 2,
    });
    // Page 2
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makePlaylistItem('pl-2')],
      next: null,
      total: 2,
    });
    // Liked Songs count
    mockSpotifyFetch.mockResolvedValueOnce({ total: 5 });

    const playlists = await adapter.getUserPlaylists();

    // Liked Songs + pl-1 + pl-2
    expect(playlists).toHaveLength(3);
    expect(playlists[1].id).toBe('pl-1');
    expect(playlists[2].id).toBe('pl-2');
  });

  // --- getPlaylistById ---

  it('getPlaylistById() with LIKED_SONGS_PLAYLIST_ID delegates to getUserPlaylists', async () => {
    mockSpotifyFetch.mockResolvedValueOnce(makeMeResponse());
    mockSpotifyFetch.mockResolvedValueOnce({ items: [], next: null, total: 0 });
    mockSpotifyFetch.mockResolvedValueOnce({ total: 7 });

    const pl = await adapter.getPlaylistById(LIKED_SONGS_PLAYLIST_ID);

    expect(pl.id).toBe(LIKED_SONGS_PLAYLIST_ID);
    expect(pl.trackCount).toBe(7);
  });

  it('getPlaylistById() for a regular playlist calls /playlists/:id', async () => {
    mockSpotifyFetch.mockResolvedValueOnce(makeMeResponse());
    mockSpotifyFetch.mockResolvedValueOnce(makePlaylistItem('pl-42'));

    const pl = await adapter.getPlaylistById('pl-42');

    expect(pl.id).toBe('pl-42');
    const lastCall = mockSpotifyFetch.mock.calls[1];
    expect(lastCall[0]).toBe('/playlists/pl-42');
  });

  // --- getPlaylistTracks ---

  it('getPlaylistTracks() for Liked Songs calls /me/tracks endpoint', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makeTrackItem('t-1'), makeTrackItem('t-2')],
      next: null,
      total: 2,
    });

    const result = await adapter.getPlaylistTracks(LIKED_SONGS_PLAYLIST_ID, 0, 50);

    expect(result.total).toBe(2);
    expect(result.tracks).toHaveLength(2);
    const [endpoint] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toContain('/me/tracks');
  });

  it('getPlaylistTracks() for a regular playlist calls /playlists/:id/items', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makeTrackItem('t-3')],
      next: null,
      total: 1,
    });

    const result = await adapter.getPlaylistTracks('pl-99', 0, 50);

    expect(result.total).toBe(1);
    const [endpoint] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toContain('/playlists/pl-99/items');
  });

  // --- addToPlaylist ---

  it('addToPlaylist() calls POST /playlists/:id/items with the correct URI', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.addToPlaylist('pl-1', 'track-abc');

    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/playlists/pl-1/items');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ uris: ['spotify:track:track-abc'] });
  });

  // --- removeFromPlaylist ---

  it('removeFromPlaylist() calls DELETE /playlists/:id/items with the correct body', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.removeFromPlaylist('pl-1', 'track-xyz');

    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/playlists/pl-1/items');
    expect(options.method).toBe('DELETE');
    expect(JSON.parse(options.body as string)).toEqual({
      items: [{ uri: 'spotify:track:track-xyz' }],
    });
  });

  // --- saveToLibrary ---

  it('saveToLibrary() calls PUT /me/library with encoded track URI', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.saveToLibrary('track-save');

    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/library?uris=spotify%3Atrack%3Atrack-save');
    expect(options.method).toBe('PUT');
    expect(options.body).toBeUndefined();
  });

  it('isInLibrary() calls GET /me/library/contains with encoded track URI and returns boolean', async () => {
    mockSpotifyFetch.mockResolvedValueOnce([true]);

    const result = await adapter.isInLibrary('track-check');

    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/library/contains?uris=spotify%3Atrack%3Atrack-check');
    expect(options.method).toBe('GET');
    expect(result).toBe(true);
  });

  it('removeFromLibrary() calls DELETE /me/library with encoded track URI', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.removeFromLibrary('track-del');

    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/library?uris=spotify%3Atrack%3Atrack-del');
    expect(options.method).toBe('DELETE');
    expect(options.body).toBeUndefined();
  });

  // --- createPlaylist ---

  it('createPlaylist() calls POST /me/playlists and returns new playlist id', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({ id: 'new-pl-id', name: 'My New Playlist' });
    mockSpotifyFetch.mockResolvedValueOnce({}); // follow call

    const newId = await adapter.createPlaylist('My New Playlist');

    expect(newId).toBe('new-pl-id');
    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/playlists');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ name: 'My New Playlist', description: 'New playlist by MusicSwipe', public: false });
  });

  // --- getCurrentPositionMs ---

  it('getCurrentPositionMs() returns progress_ms from /me/player', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({ progress_ms: 12345 });

    const pos = await adapter.getCurrentPositionMs();

    expect(pos).toBe(12345);
    const [endpoint] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/player');
  });

  it('getCurrentPositionMs() returns 0 when progress_ms is null', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({ progress_ms: null });

    const pos = await adapter.getCurrentPositionMs();

    expect(pos).toBe(0);
  });

  // --- openPlatformDeepLink ---

  it('openPlatformDeepLink() resolves without error (stub)', async () => {
    await expect(adapter.openPlatformDeepLink('spotify:playlist:123')).resolves.toBeUndefined();
    expect(mockSpotifyFetch).not.toHaveBeenCalled();
  });

  // --- capabilities ---

  it('capabilities flags match expected Spotify values', () => {
    expect(adapter.capabilities.requiresPremium).toBe(true);
    expect(adapter.capabilities.supportsSeek).toBe(true);
    expect(adapter.capabilities.supportsLibrarySave).toBe(true);
    expect(adapter.capabilities.supportsPlaylistCreation).toBe(true);
  });
});
