import type { MusicPlatformAdapter, Playlist, Track, AdapterCapabilities } from '../interface';
import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '../interface';
import { spotifyFetch, type SpotifyAuthContext } from './spotifyFetch';
import { mapSpotifyPlaylist, mapSpotifyTrack, type SpotifyPlaylistItem, type SpotifyTrackItem } from './mappers';
import { openPlatformDeepLink } from '../../deeplink/PlatformDeepLink';

interface SpotifyPaginatedResponse<T> {
  items: T[];
  next: string | null;
  total: number;
}

interface SpotifyMeResponse {
  id: string;
  display_name: string | null;
  email: string | null;
}

interface SpotifyNewPlaylistResponse {
  id: string;
  name: string;
}

interface SpotifyDevice {
  id: string;
  is_active: boolean;
  name: string;
  type: string;
}

interface SpotifyDevicesResponse {
  devices: SpotifyDevice[];
}

interface SpotifyPlayerState {
  progress_ms: number | null;
}

export class SpotifyAdapter implements MusicPlatformAdapter {
  readonly capabilities: AdapterCapabilities = {
    requiresExplicitFollow: false,
    supportsSeek: true,
    requiresPremium: true,
    supportsLibrarySave: true,
    supportsPlaylistCreation: true,
  };

  private readonly auth: SpotifyAuthContext;
  private cachedUserId: string | null = null;
  private cachedDeviceId: string | null = null;

  constructor(auth: SpotifyAuthContext) {
    this.auth = auth;
  }

  /**
   * Fetches the active Spotify device and caches its ID.
   * Throws NO_ACTIVE_DEVICE if none are active, PREMIUM_REQUIRED if Spotify
   * signals that playback requires a premium account.
   */
  private async getActiveDeviceId(): Promise<string> {
    if (this.cachedDeviceId) return this.cachedDeviceId;

    const data = await spotifyFetch<SpotifyDevicesResponse>(
      '/me/player/devices',
      {},
      this.auth,
    );

    const activeDevice = data.devices.find((d) => d.is_active);
    if (!activeDevice) {
      throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'No active Spotify device found');
    }

    this.cachedDeviceId = activeDevice.id;
    return activeDevice.id;
  }

  async isAuthenticated(): Promise<boolean> {
    return Boolean(this.auth.accessToken && this.auth.expiresAt > Date.now());
  }

  async refreshAuth(): Promise<void> {
    // spotifyFetch handles refresh internally; calling this is a no-op for now
  }

  async getUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;
    const data = await spotifyFetch<SpotifyMeResponse>('/me', {}, this.auth);
    this.cachedUserId = data.id;
    return data.id;
  }

  async getUserPlaylists(): Promise<Playlist[]> {
    const userId = await this.getUserId();

    // Paginate through all playlists
    const allItems: SpotifyPlaylistItem[] = [];
    let endpoint: string | null = '/me/playlists?limit=50';

    while (endpoint) {
      const data: SpotifyPaginatedResponse<SpotifyPlaylistItem> =
        await spotifyFetch<SpotifyPaginatedResponse<SpotifyPlaylistItem>>(
          endpoint,
          {},
          this.auth,
        );
      allItems.push(...data.items.filter(Boolean));
      // next is a full URL; extract the path+query portion for spotifyFetch
      endpoint = data.next
        ? data.next.replace('https://api.spotify.com/v1', '')
        : null;
    }

    const playlists = allItems.map((item) => mapSpotifyPlaylist(item, userId));

    // Fetch Liked Songs track count — guard against null/empty response
    let likedTrackCount = 0;
    try {
      const likedData = await spotifyFetch<{ total: number }>(
        '/me/tracks?limit=1',
        {},
        this.auth,
      );
      likedTrackCount = likedData?.total ?? 0;
    } catch {
      // Non-fatal: Liked Songs still shows with count 0
    }

    const likedSongs: Playlist = {
      id: LIKED_SONGS_PLAYLIST_ID,
      name: 'Liked Songs',
      coverArtUrl: null,
      trackCount: likedTrackCount,
      isOwned: true,
      isFollowed: false,
    };

    return [likedSongs, ...playlists];
  }

  async getPlaylistById(playlistId: string): Promise<Playlist> {
    if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
      const playlists = await this.getUserPlaylists();
      return playlists[0]; // Liked Songs is always first
    }

    const userId = await this.getUserId();
    const data = await spotifyFetch<SpotifyPlaylistItem>(
      `/playlists/${playlistId}`,
      {},
      this.auth,
    );
    return mapSpotifyPlaylist(data, userId);
  }

  async getPlaylistTracks(
    playlistId: string,
    offset = 0,
    limit = 50,
  ): Promise<{ tracks: Track[]; total: number }> {
    const isLikedSongs = playlistId === LIKED_SONGS_PLAYLIST_ID;
    console.log(`[SpotifyAdapter] getPlaylistTracks — playlistId="${playlistId}" isLikedSongs=${isLikedSongs} LIKED_SONGS_PLAYLIST_ID="${LIKED_SONGS_PLAYLIST_ID}"`);
    // /me/tracks accepts max 50; /playlists/{id}/items accepts up to 100
    const effectiveLimit = isLikedSongs ? Math.min(limit, 50) : limit;
    const endpoint = isLikedSongs
      ? `/me/tracks?offset=${offset}&limit=${effectiveLimit}`
      : `/playlists/${playlistId}/items?offset=${offset}&limit=${effectiveLimit}`;

    const data = await spotifyFetch<SpotifyPaginatedResponse<SpotifyTrackItem>>(
      endpoint,
      {},
      this.auth,
    );

    return {
      tracks: (data?.items ?? [])
        .filter((item): item is SpotifyTrackItem => {
          if (!item) return false;
          const t = item.item ?? item.track;
          return t !== null && t !== undefined && t.type === 'track' && t.id !== null;
        })
        .map(mapSpotifyTrack),
      total: data?.total ?? 0,
    };
  }

  /**
   * Starts playback of a track URI on the active Spotify device.
   * Invalidates the device cache if the device is no longer active (Spotify
   * returns 404 when no device is available, which we re-map to NO_ACTIVE_DEVICE).
   */
  async play(trackUri: string): Promise<void> {
    const deviceId = await this.getActiveDeviceId();

    try {
      await spotifyFetch(
        `/me/player/play?device_id=${deviceId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ uris: [trackUri] }),
        },
        this.auth,
      );
    } catch (error) {
      if (error instanceof PlatformError && error.code === PlatformErrorCode.NOT_FOUND) {
        // Spotify returns 404 when the targeted device is no longer active
        this.cachedDeviceId = null;
        throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'Device became inactive');
      }
      throw error;
    }
  }

  /** Pauses playback on the current active device. */
  async pause(): Promise<void> {
    try {
      await spotifyFetch(
        '/me/player/pause',
        { method: 'PUT' },
        this.auth,
      );
    } catch (error) {
      if (error instanceof PlatformError && error.code === PlatformErrorCode.NOT_FOUND) {
        this.cachedDeviceId = null;
        throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'No active device to pause');
      }
      throw error;
    }
  }

  /** Seeks to the given position (ms) within the currently playing track. */
  async seek(positionMs: number): Promise<void> {
    try {
      await spotifyFetch(
        `/me/player/seek?position_ms=${Math.round(positionMs)}`,
        { method: 'PUT' },
        this.auth,
      );
    } catch (error) {
      if (error instanceof PlatformError && error.code === PlatformErrorCode.NOT_FOUND) {
        this.cachedDeviceId = null;
        throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'No active device to seek');
      }
      throw error;
    }
  }

  async getCurrentTrack(): Promise<Track | null> {
    // Deferred to a later phase — not blocking swipe UI
    return null;
  }

  /** Returns the current playback position in milliseconds, or 0 if nothing is playing. */
  async getCurrentPositionMs(): Promise<number> {
    const data = await spotifyFetch<SpotifyPlayerState>(
      '/me/player',
      {},
      this.auth,
    );
    return data.progress_ms ?? 0;
  }

  async addToPlaylist(playlistId: string, trackId: string): Promise<void> {
    if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
      await this.saveToLibrary(trackId);
      return;
    }
    await spotifyFetch(
      `/playlists/${playlistId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      },
      this.auth,
    );
  }

  async removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
      await this.removeFromLibrary(trackId);
      return;
    }
    await spotifyFetch(
      `/playlists/${playlistId}/items`,
      {
        method: 'DELETE',
        body: JSON.stringify({ items: [{ uri: `spotify:track:${trackId}` }] }),
      },
      this.auth,
    );
  }

  async saveToLibrary(trackId: string): Promise<void> {
    const uri = encodeURIComponent(`spotify:track:${trackId}`);
    await spotifyFetch(
      `/me/library?uris=${uri}`,
      { method: 'PUT' },
      this.auth,
    );
  }

  async removeFromLibrary(trackId: string): Promise<void> {
    const uri = encodeURIComponent(`spotify:track:${trackId}`);
    await spotifyFetch(
      `/me/library?uris=${uri}`,
      { method: 'DELETE' },
      this.auth,
    );
  }

  async isInLibrary(trackId: string): Promise<boolean> {
    const uri = encodeURIComponent(`spotify:track:${trackId}`);
    const result = await spotifyFetch<boolean[]>(
      `/me/library/contains?uris=${uri}`,
      { method: 'GET' },
      this.auth,
    );
    return result[0] ?? false;
  }

  async createPlaylist(name: string): Promise<string> {
    const data = await spotifyFetch<SpotifyNewPlaylistResponse>(
      '/me/playlists',
      {
        method: 'POST',
        body: JSON.stringify({ name, description: 'New playlist by MusicSwipe', public: false }),
      },
      this.auth,
    );

    // Follow the newly created playlist so it appears in the user's Spotify library sidebar.
    // Without this call the playlist exists but is invisible until the user manually finds it.
    try {
      await spotifyFetch(
        `/playlists/${data.id}/followers`,
        { method: 'PUT', body: JSON.stringify({ public: false }) },
        this.auth,
      );
    } catch {
      // Non-fatal: playlist was created; user can follow it manually from Spotify.
    }

    return data.id;
  }

  async openPlatformDeepLink(uri: string): Promise<void> {
    console.log('[SpotifyAdapter] NO_ACTIVE_DEVICE — triggering deep link:', uri);
    await openPlatformDeepLink(uri);
  }
}
