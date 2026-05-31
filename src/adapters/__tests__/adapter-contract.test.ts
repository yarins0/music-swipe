import { MockAdapter } from '../mock/MockAdapter';
import { PlatformError, PlatformErrorCode, AdapterCapabilities, Track, LIKED_SONGS_PLAYLIST_ID } from '../interface';

describe('adapter contract — MockAdapter', () => {
  describe('auth', () => {
    it('isAuthenticated() returns true with default fixtures', async () => {
      const adapter = new MockAdapter();
      expect(await adapter.isAuthenticated()).toBe(true);
    });

    it('isAuthenticated() returns false when fixture authenticated=false', async () => {
      const adapter = new MockAdapter({ authenticated: false });
      expect(await adapter.isAuthenticated()).toBe(false);
    });

    it('refreshAuth() resolves without throwing', async () => {
      const adapter = new MockAdapter();
      await expect(adapter.refreshAuth()).resolves.toBeUndefined();
    });
  });

  describe('identity', () => {
    it('getUserId() returns "mock-user" by default', async () => {
      const adapter = new MockAdapter();
      expect(await adapter.getUserId()).toBe('mock-user');
    });

    it('getUserId() returns overridden userId from fixtures', async () => {
      const adapter = new MockAdapter({ userId: 'custom-user' });
      expect(await adapter.getUserId()).toBe('custom-user');
    });

    it('getUserProfile() returns spotifyId matching getUserId()', async () => {
      const adapter = new MockAdapter();
      const profile = await adapter.getUserProfile();
      expect(profile.spotifyId).toBe(await adapter.getUserId());
    });

    it('getUserProfile() returns a displayName and nullable avatarUrl', async () => {
      const adapter = new MockAdapter();
      const profile = await adapter.getUserProfile();
      expect(typeof profile.displayName === 'string' || profile.displayName === null).toBe(true);
      expect(typeof profile.avatarUrl === 'string' || profile.avatarUrl === null).toBe(true);
    });
  });

  describe('playlists', () => {
    it('getUserPlaylists() returns at least 2 playlists', async () => {
      const adapter = new MockAdapter();
      const playlists = await adapter.getUserPlaylists();
      expect(playlists.length).toBeGreaterThanOrEqual(2);
    });

    it('getPlaylistById() returns correct playlist for known id', async () => {
      const adapter = new MockAdapter();
      const playlist = await adapter.getPlaylistById('mock-playlist-1');
      expect(playlist.id).toBe('mock-playlist-1');
      expect(playlist.name).toBe('Mock Playlist One');
    });

    it('getPlaylistById() throws PlatformError(NOT_FOUND) for unknown id', async () => {
      const adapter = new MockAdapter();
      await expect(adapter.getPlaylistById('nonexistent-id')).rejects.toMatchObject({
        code: PlatformErrorCode.NOT_FOUND,
      });
    });

    it('getPlaylistById() error is instance of PlatformError', async () => {
      const adapter = new MockAdapter();
      try {
        await adapter.getPlaylistById('nonexistent-id');
        fail('expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformError);
      }
    });
  });

  describe('tracks', () => {
    it('getPlaylistTracks() returns { tracks, total }', async () => {
      const adapter = new MockAdapter();
      const result = await adapter.getPlaylistTracks('mock-playlist-1', 0, 50);
      expect(result).toHaveProperty('tracks');
      expect(result).toHaveProperty('total');
    });

    it('getPlaylistTracks() total equals full fixture track count', async () => {
      const adapter = new MockAdapter();
      const result = await adapter.getPlaylistTracks('mock-playlist-1', 0, 50);
      expect(result.total).toBe(adapter.fixtures.tracks.length);
    });

    it('getPlaylistTracks() returns Track-shaped objects', async () => {
      const adapter = new MockAdapter();
      const { tracks } = await adapter.getPlaylistTracks('mock-playlist-1', 0, 50);
      expect(tracks.length).toBeGreaterThan(0);
      const track: Track = tracks[0];
      expect(typeof track.id).toBe('string');
      expect(typeof track.uri).toBe('string');
      expect(typeof track.title).toBe('string');
      expect(typeof track.artist).toBe('string');
      expect(Array.isArray(track.artists)).toBe(true);
      expect(typeof track.album).toBe('string');
      expect(typeof track.albumArtUrl).toBe('string');
      expect(typeof track.durationMs).toBe('number');
      expect(track.previewUrl === null || typeof track.previewUrl === 'string').toBe(true);
    });

    it('getPlaylistTracks() respects offset and limit', async () => {
      const adapter = new MockAdapter();
      const first = await adapter.getPlaylistTracks('mock-playlist-1', 0, 1);
      const second = await adapter.getPlaylistTracks('mock-playlist-1', 1, 1);
      expect(first.tracks).toHaveLength(1);
      expect(second.tracks).toHaveLength(1);
      expect(first.tracks[0].id).not.toBe(second.tracks[0].id);
    });
  });

  describe('playback', () => {
    it('play() resolves and records uri in calls.play', async () => {
      const adapter = new MockAdapter();
      await adapter.play('mock:track:1');
      expect(adapter.calls.play).toContain('mock:track:1');
    });

    it('pause() resolves without throwing', async () => {
      const adapter = new MockAdapter();
      await expect(adapter.pause()).resolves.toBeUndefined();
    });

    it('seek() resolves and records positionMs in calls.seek', async () => {
      const adapter = new MockAdapter();
      await adapter.seek(5000);
      expect(adapter.calls.seek).toContain(5000);
    });

    it('getCurrentTrack() returns Track or null', async () => {
      const adapter = new MockAdapter();
      const track = await adapter.getCurrentTrack();
      expect(track === null || typeof (track as Track).id === 'string').toBe(true);
    });

    it('getCurrentPositionMs() returns a number', async () => {
      const adapter = new MockAdapter();
      const pos = await adapter.getCurrentPositionMs();
      expect(typeof pos).toBe('number');
    });

    it('getCurrentPositionMs() reflects last seek position', async () => {
      const adapter = new MockAdapter();
      await adapter.seek(12345);
      expect(await adapter.getCurrentPositionMs()).toBe(12345);
    });
  });

  describe('library', () => {
    it('addToPlaylist() resolves and records the call', async () => {
      const adapter = new MockAdapter();
      await adapter.addToPlaylist('mock-playlist-1', 'mock-track-1');
      expect(adapter.calls.addToPlaylist).toContainEqual({
        playlistId: 'mock-playlist-1',
        trackId: 'mock-track-1',
      });
    });

    it('addToPlaylist() throws NOT_FOUND for unknown playlist', async () => {
      const adapter = new MockAdapter();
      await expect(
        adapter.addToPlaylist('nonexistent-playlist', 'mock-track-1'),
      ).rejects.toMatchObject({ code: PlatformErrorCode.NOT_FOUND });
    });

    it('addToPlaylist(LIKED_SONGS_PLAYLIST_ID) delegates to saveToLibrary', async () => {
      const adapter = new MockAdapter({ supportsLibrarySave: true });
      await adapter.addToPlaylist(LIKED_SONGS_PLAYLIST_ID, 'mock-track-1');
      expect(adapter.calls.saveToLibrary).toContain('mock-track-1');
    });

    it('removeFromPlaylist() resolves and records the call', async () => {
      const adapter = new MockAdapter();
      await adapter.removeFromPlaylist('mock-playlist-1', 'mock-track-1');
      expect(adapter.calls.removeFromPlaylist).toContainEqual({
        playlistId: 'mock-playlist-1',
        trackId: 'mock-track-1',
      });
    });

    it('removeFromPlaylist(LIKED_SONGS_PLAYLIST_ID) delegates to removeFromLibrary', async () => {
      const adapter = new MockAdapter();
      await adapter.removeFromPlaylist(LIKED_SONGS_PLAYLIST_ID, 'mock-track-1');
      expect(adapter.calls.removeFromLibrary).toContain('mock-track-1');
    });

    it('saveToLibrary() resolves and records call when supportsLibrarySave=true', async () => {
      const adapter = new MockAdapter({ supportsLibrarySave: true });
      await adapter.saveToLibrary('mock-track-1');
      expect(adapter.calls.saveToLibrary).toContain('mock-track-1');
    });

    it('saveToLibrary() throws PERMISSION_DENIED when supportsLibrarySave=false', async () => {
      const adapter = new MockAdapter({ supportsLibrarySave: false });
      await expect(adapter.saveToLibrary('mock-track-1')).rejects.toMatchObject({
        code: PlatformErrorCode.PERMISSION_DENIED,
      });
    });

    it('isInLibrary() returns true for a track in likedTrackIds fixture', async () => {
      const adapter = new MockAdapter({ likedTrackIds: new Set(['mock-track-1']) });
      expect(await adapter.isInLibrary('mock-track-1')).toBe(true);
    });

    it('isInLibrary() returns false for a track not in likedTrackIds fixture', async () => {
      const adapter = new MockAdapter();
      expect(await adapter.isInLibrary('mock-track-1')).toBe(false);
    });

    it('removeFromLibrary() resolves and records the call', async () => {
      const adapter = new MockAdapter();
      await adapter.removeFromLibrary('mock-track-1');
      expect(adapter.calls.removeFromLibrary).toContain('mock-track-1');
    });
  });

  describe('playlist creation', () => {
    it('createPlaylist() returns a non-empty string id', async () => {
      const adapter = new MockAdapter();
      const id = await adapter.createPlaylist('My Mix');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('createPlaylist() adds the new playlist to getUserPlaylists()', async () => {
      const adapter = new MockAdapter();
      const beforeCount = (await adapter.getUserPlaylists()).length;
      await adapter.createPlaylist('My Mix');
      const afterPlaylists = await adapter.getUserPlaylists();
      expect(afterPlaylists.length).toBe(beforeCount + 1);
      expect(afterPlaylists.some((p) => p.name === 'My Mix')).toBe(true);
    });

    it('createPlaylist() throws PERMISSION_DENIED when supportsPlaylistCreation=false', async () => {
      const adapter = new MockAdapter({ supportsPlaylistCreation: false });
      await expect(adapter.createPlaylist('Blocked Mix')).rejects.toMatchObject({
        code: PlatformErrorCode.PERMISSION_DENIED,
      });
    });
  });

  describe('deep link', () => {
    it('openPlatformDeepLink() resolves and records the uri', async () => {
      const adapter = new MockAdapter();
      await adapter.openPlatformDeepLink('spotify:track:x');
      expect(adapter.calls.openPlatformDeepLink).toContain('spotify:track:x');
    });

    it('openPlaylistInApp() resolves and records the playlistId', async () => {
      const adapter = new MockAdapter();
      await adapter.openPlaylistInApp('playlist-abc');
      expect(adapter.calls.openPlaylistInApp).toContain('playlist-abc');
    });
  });

  describe('capabilities', () => {
    it('default capabilities shape matches AdapterCapabilities interface', () => {
      const adapter = new MockAdapter();
      const caps: AdapterCapabilities = adapter.capabilities;
      expect(typeof caps.requiresExplicitFollow).toBe('boolean');
      expect(typeof caps.supportsSeek).toBe('boolean');
      expect(typeof caps.requiresPremium).toBe('boolean');
      expect(typeof caps.supportsLibrarySave).toBe('boolean');
      expect(typeof caps.supportsPlaylistCreation).toBe('boolean');
      expect(typeof caps.canReadUnownedPlaylists).toBe('boolean');
    });

    it('supportsLibrarySave=false fixture sets capability to false', () => {
      const adapter = new MockAdapter({ supportsLibrarySave: false });
      expect(adapter.capabilities.supportsLibrarySave).toBe(false);
    });

    it('supportsPlaylistCreation=false fixture sets capability to false', () => {
      const adapter = new MockAdapter({ supportsPlaylistCreation: false });
      expect(adapter.capabilities.supportsPlaylistCreation).toBe(false);
    });
  });
});
