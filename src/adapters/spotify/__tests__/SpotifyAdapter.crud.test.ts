import { SpotifyAdapter } from '../SpotifyAdapter';
import { LIKED_SONGS_PLAYLIST_ID } from '../../interface';
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

  // --- removeDuplicatesFromPlaylist ---

  it('removeDuplicatesFromPlaylist() removes every copy of a duplicated track and re-adds exactly one', async () => {
    // t1 appears twice, t2 once. Spotify's DELETE removes all copies by URI, so the
    // adapter removes all of t1 then adds one back.
    mockSpotifyFetch
      .mockResolvedValueOnce({
        items: [makeTrackItem('t1'), makeTrackItem('t2'), makeTrackItem('t1')],
        next: null,
        total: 3,
      })
      .mockResolvedValueOnce({}) // DELETE all copies of t1
      .mockResolvedValueOnce({}); // POST one t1 back

    const removed = await adapter.removeDuplicatesFromPlaylist('pl-1');

    expect(removed).toBe(1);
    const deleteCall = mockSpotifyFetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
    const addCall = mockSpotifyFetch.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(deleteCall![0]).toBe('/playlists/pl-1/items');
    expect(JSON.parse(deleteCall![1].body as string)).toEqual({ items: [{ uri: 'spotify:track:t1' }] });
    expect(addCall![0]).toBe('/playlists/pl-1/items');
    expect(JSON.parse(addCall![1].body as string)).toEqual({ uris: ['spotify:track:t1'] });
    // t2 was unique — never touched.
    const bodies = mockSpotifyFetch.mock.calls.map((c) => String(c[1]?.body ?? ''));
    expect(bodies.some((b) => b.includes('t2'))).toBe(false);
  });

  it('removeDuplicatesFromPlaylist() uses the stored URI for a relinked track', async () => {
    // A relinked track: its playable `uri` differs from the URI stored in the playlist,
    // which lives in `linked_from`. Both the remove and the re-add must use the stored one.
    const relinked = (id: string, storedUri: string) => ({
      track: {
        id,
        uri: `spotify:track:${id}-playable`,
        name: `Track ${id}`,
        type: 'track',
        artists: [{ id: 'a1', name: 'Artist One' }],
        album: { name: 'Album', images: [] },
        duration_ms: 180000,
        preview_url: null,
        linked_from: { uri: storedUri },
      },
    });

    mockSpotifyFetch
      .mockResolvedValueOnce({
        items: [relinked('t1', 'spotify:track:STORED'), makeTrackItem('t2'), relinked('t1', 'spotify:track:STORED')],
        next: null,
        total: 3,
      })
      .mockResolvedValueOnce({}) // DELETE
      .mockResolvedValueOnce({}); // POST

    await adapter.removeDuplicatesFromPlaylist('pl-1');

    const deleteCall = mockSpotifyFetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
    const addCall = mockSpotifyFetch.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(deleteCall![1].body as string)).toEqual({ items: [{ uri: 'spotify:track:STORED' }] });
    expect(JSON.parse(addCall![1].body as string)).toEqual({ uris: ['spotify:track:STORED'] });
  });

  it('removeDuplicatesFromPlaylist() skips local files — never removes them', async () => {
    const localItem = {
      is_local: true,
      track: {
        id: 'loc',
        uri: 'spotify:local:Artist:Album:Title:180',
        name: 'Local Track',
        type: 'track',
        artists: [{ id: 'a1', name: 'Artist One' }],
        album: { name: 'Album', images: [] },
        duration_ms: 180000,
        preview_url: null,
      },
    };
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [localItem, makeTrackItem('t2'), localItem],
      next: null,
      total: 3,
    });

    const removed = await adapter.removeDuplicatesFromPlaylist('pl-1');

    expect(removed).toBe(0);
    // Scan only — no destructive DELETE for the duplicated local file.
    expect(mockSpotifyFetch).toHaveBeenCalledTimes(1);
  });

  it('removeDuplicatesFromPlaylist() makes no DELETE call when there are no duplicates', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makeTrackItem('t1'), makeTrackItem('t2')],
      next: null,
      total: 2,
    });

    const removed = await adapter.removeDuplicatesFromPlaylist('pl-1');

    expect(removed).toBe(0);
    // Only the single read call — no destructive DELETE.
    expect(mockSpotifyFetch).toHaveBeenCalledTimes(1);
  });

  it('removeDuplicatesFromPlaylist(LIKED_SONGS_PLAYLIST_ID) returns 0 without any API call', async () => {
    const removed = await adapter.removeDuplicatesFromPlaylist(LIKED_SONGS_PLAYLIST_ID);
    expect(removed).toBe(0);
    expect(mockSpotifyFetch).not.toHaveBeenCalled();
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

  // --- addToPlaylist / removeFromPlaylist with LIKED_SONGS ---

  it('addToPlaylist() with LIKED_SONGS_PLAYLIST_ID delegates to saveToLibrary', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.addToPlaylist(LIKED_SONGS_PLAYLIST_ID, 'track-liked');

    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/library?uris=spotify%3Atrack%3Atrack-liked');
    expect(options.method).toBe('PUT');
  });

  it('removeFromPlaylist() with LIKED_SONGS_PLAYLIST_ID delegates to removeFromLibrary', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({});

    await adapter.removeFromPlaylist(LIKED_SONGS_PLAYLIST_ID, 'track-liked');

    const [endpoint, options] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toBe('/me/library?uris=spotify%3Atrack%3Atrack-liked');
    expect(options.method).toBe('DELETE');
  });

  it('isInLibrary() returns false when API returns [false]', async () => {
    mockSpotifyFetch.mockResolvedValueOnce([false]);

    const result = await adapter.isInLibrary('track-not-saved');

    expect(result).toBe(false);
  });

  it('isInLibrary() returns false (not true) when result array is empty', async () => {
    mockSpotifyFetch.mockResolvedValueOnce([]);

    const result = await adapter.isInLibrary('track-missing');

    expect(result).toBe(false);
  });

  // --- getPlaylistTrackIds ---

  it('getPlaylistTrackIds() returns the set of track ids from a regular playlist', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makeTrackItem('t-1'), makeTrackItem('t-2')],
      next: null,
      total: 2,
    });

    const ids = await adapter.getPlaylistTrackIds('pl-1');

    expect(ids).toEqual(new Set(['t-1', 't-2']));
    const [endpoint] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toContain('/playlists/pl-1/items');
  });

  it('getPlaylistTrackIds() paginates until all pages are read', async () => {
    // A regular playlist pages at 100; total > 100 forces a second fetch (offset < total).
    const page = (count: number, startId: number) => ({
      items: Array.from({ length: count }, (_, i) => makeTrackItem(`t-${startId + i}`)),
      next: null,
      total: 150,
    });
    mockSpotifyFetch
      .mockResolvedValueOnce(page(100, 0))
      .mockResolvedValueOnce(page(50, 100));

    const ids = await adapter.getPlaylistTrackIds('pl-1');

    expect(ids.size).toBe(150);
    expect(mockSpotifyFetch).toHaveBeenCalledTimes(2);
  });

  it('getPlaylistTrackIds(LIKED_SONGS_PLAYLIST_ID) reads the /me/tracks endpoint', async () => {
    mockSpotifyFetch.mockResolvedValueOnce({
      items: [makeTrackItem('t-1')],
      next: null,
      total: 1,
    });

    const ids = await adapter.getPlaylistTrackIds(LIKED_SONGS_PLAYLIST_ID);

    expect(ids).toEqual(new Set(['t-1']));
    const [endpoint] = mockSpotifyFetch.mock.calls[0];
    expect(endpoint).toContain('/me/tracks');
  });

  // --- capabilities ---

  it('capabilities flags match expected Spotify values', () => {
    expect(adapter.capabilities.requiresPremium).toBe(true);
    expect(adapter.capabilities.supportsSeek).toBe(true);
    expect(adapter.capabilities.supportsLibrarySave).toBe(true);
    expect(adapter.capabilities.supportsPlaylistCreation).toBe(true);
  });

  // --- parsePlaylistReference ---

  it('parsePlaylistReference() extracts the id from an open.spotify.com URL', () => {
    expect(adapter.parsePlaylistReference('https://open.spotify.com/playlist/37i9dQZF1DX5Vy6DFOcx00')).toBe(
      '37i9dQZF1DX5Vy6DFOcx00',
    );
  });

  it('parsePlaylistReference() extracts the id from a spotify:playlist: URI', () => {
    expect(adapter.parsePlaylistReference('spotify:playlist:37i9dQZF1DX5Vy6DFOcx00')).toBe(
      '37i9dQZF1DX5Vy6DFOcx00',
    );
  });

  it('parsePlaylistReference() accepts a raw 22-character base62 id', () => {
    expect(adapter.parsePlaylistReference('37i9dQZF1DX5Vy6DFOcx00')).toBe('37i9dQZF1DX5Vy6DFOcx00');
  });

  it('parsePlaylistReference() trims surrounding whitespace before matching a raw id', () => {
    expect(adapter.parsePlaylistReference('  37i9dQZF1DX5Vy6DFOcx00  ')).toBe('37i9dQZF1DX5Vy6DFOcx00');
  });

  it('parsePlaylistReference() returns null for an invalid URL', () => {
    expect(adapter.parsePlaylistReference('https://example.com/foo')).toBeNull();
  });

  it('parsePlaylistReference() returns null for a string that is not a valid id', () => {
    expect(adapter.parsePlaylistReference('not-a-playlist')).toBeNull();
  });

  it('parsePlaylistReference() returns null for an empty string', () => {
    expect(adapter.parsePlaylistReference('')).toBeNull();
  });
});
