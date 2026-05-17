import type { MusicPlatformAdapter, Playlist, Track, AdapterCapabilities } from '../interface';
import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '../interface';
import { spotifyFetch, type SpotifyAuthContext } from './spotifyFetch';
import { mapSpotifyPlaylist, mapSpotifyTrack, type SpotifyPlaylistItem, type SpotifyTrackItem } from './mappers';

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

  constructor(auth: SpotifyAuthContext) {
    this.auth = auth;
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
      allItems.push(...data.items);
      // next is a full URL; extract the path+query portion for spotifyFetch
      endpoint = data.next
        ? data.next.replace('https://api.spotify.com/v1', '')
        : null;
    }

    const playlists = allItems.map((item) => mapSpotifyPlaylist(item, userId));

    // Fetch Liked Songs track count
    const likedData = await spotifyFetch<{ total: number }>(
      '/me/tracks?limit=1',
      {},
      this.auth,
    );

    const likedSongs: Playlist = {
      id: LIKED_SONGS_PLAYLIST_ID,
      name: 'Liked Songs',
      coverArtUrl: null,
      trackCount: likedData.total,
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
    const endpoint =
      playlistId === LIKED_SONGS_PLAYLIST_ID
        ? `/me/tracks?offset=${offset}&limit=${limit}`
        : `/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`;

    const data = await spotifyFetch<SpotifyPaginatedResponse<SpotifyTrackItem>>(
      endpoint,
      {},
      this.auth,
    );

    return {
      tracks: data.items.map(mapSpotifyTrack),
      total: data.total,
    };
  }

  // Playback — stubs until Phase 2
  async play(_trackUri: string): Promise<void> {
    throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'Playback not implemented in Phase 1');
  }

  async pause(): Promise<void> {
    throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'Playback not implemented in Phase 1');
  }

  async seek(_positionMs: number): Promise<void> {
    throw new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'Playback not implemented in Phase 1');
  }

  async getCurrentTrack(): Promise<Track | null> {
    return null;
  }

  async getCurrentPositionMs(): Promise<number> {
    return 0;
  }

  async addToPlaylist(playlistId: string, trackId: string): Promise<void> {
    await spotifyFetch(
      `/playlists/${playlistId}/tracks`,
      {
        method: 'POST',
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      },
      this.auth,
    );
  }

  async removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    await spotifyFetch(
      `/playlists/${playlistId}/tracks`,
      {
        method: 'DELETE',
        body: JSON.stringify({ tracks: [{ uri: `spotify:track:${trackId}` }] }),
      },
      this.auth,
    );
  }

  async saveToLibrary(trackId: string): Promise<void> {
    await spotifyFetch(
      '/me/tracks',
      {
        method: 'PUT',
        body: JSON.stringify({ ids: [trackId] }),
      },
      this.auth,
    );
  }

  async createPlaylist(name: string): Promise<string> {
    const userId = await this.getUserId();
    const data = await spotifyFetch<SpotifyNewPlaylistResponse>(
      `/users/${userId}/playlists`,
      {
        method: 'POST',
        body: JSON.stringify({ name, public: false }),
      },
      this.auth,
    );
    return data.id;
  }

  async openPlatformDeepLink(_uri: string): Promise<void> {
    // Phase 5 stub — wired into architecture now, implemented later
  }
}
