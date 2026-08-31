import {
  AdapterCapabilities,
  MusicPlatformAdapter,
  Playlist,
  PlatformError,
  PlatformErrorCode,
  Track,
  UserProfile,
  LIKED_SONGS_PLAYLIST_ID,
} from '../interface';

interface MockFixtures {
  tracks?: Track[];
  playlists?: Playlist[];
  userId?: string;
  authenticated?: boolean;
  supportsLibrarySave?: boolean;
  supportsPlaylistCreation?: boolean;
  likedTrackIds?: Set<string>;
  // Defaults to null to match SpotifyAdapter, which does not yet report a
  // currently playing track. Tests opt in by passing a Track here.
  currentTrack?: Track | null;
}

const DEFAULT_TRACKS: Track[] = [
  {
    id: 'mock-track-1',
    uri: 'mock:track:1',
    title: 'Mock Track One',
    artist: 'Mock Artist',
    artists: ['Mock Artist'],
    album: 'Mock Album',
    albumArtUrl: 'https://example.com/art1.jpg',
    durationMs: 210000,
    previewUrl: null,
  },
  {
    id: 'mock-track-2',
    uri: 'mock:track:2',
    title: 'Mock Track Two',
    artist: 'Mock Artist',
    artists: ['Mock Artist'],
    album: 'Mock Album',
    albumArtUrl: 'https://example.com/art2.jpg',
    durationMs: 180000,
    previewUrl: null,
  },
  {
    id: 'mock-track-3',
    uri: 'mock:track:3',
    title: 'Mock Track Three',
    artist: 'Another Artist',
    artists: ['Another Artist'],
    album: 'Another Album',
    albumArtUrl: 'https://example.com/art3.jpg',
    durationMs: 240000,
    previewUrl: null,
  },
];

const DEFAULT_PLAYLISTS: Playlist[] = [
  {
    id: 'mock-playlist-1',
    name: 'Mock Playlist One',
    coverArtUrl: null,
    trackCount: 3,
    isOwned: true,
    isFollowed: false,
  },
  {
    id: 'mock-playlist-2',
    name: 'Mock Playlist Two',
    coverArtUrl: null,
    trackCount: 0,
    isOwned: true,
    isFollowed: false,
  },
];

export interface MockCalls {
  play: string[];
  seek: number[];
  addToPlaylist: { playlistId: string; trackId: string }[];
  removeFromPlaylist: { playlistId: string; trackId: string }[];
  saveToLibrary: string[];
  removeFromLibrary: string[];
  isInLibrary: string[];
  getPlaylistTrackIds: string[];
  createPlaylist: string[];
  removeDuplicatesFromPlaylist: string[];
  openPlatformDeepLink: string[];
  openPlaylistInApp: string[];
}

export class MockAdapter implements MusicPlatformAdapter {
  readonly capabilities: AdapterCapabilities;

  readonly calls: MockCalls = {
    play: [],
    seek: [],
    addToPlaylist: [],
    removeFromPlaylist: [],
    saveToLibrary: [],
    removeFromLibrary: [],
    isInLibrary: [],
    getPlaylistTrackIds: [],
    createPlaylist: [],
    removeDuplicatesFromPlaylist: [],
    openPlatformDeepLink: [],
    openPlaylistInApp: [],
  };

  /** Tracks which tracks are in each playlist after add/remove calls. Keyed by playlistId. */
  readonly playlistContents = new Map<string, Set<string>>();

  /** Directly inspectable fixture state for tests. */
  readonly fixtures: Required<MockFixtures> & { tracks: Track[]; playlists: Playlist[]; likedTrackIds: Set<string> };

  private lastPlayedUri: string | null = null;
  private lastSeekPositionMs: number = 0;

  private nextPlaylistId = 100;

  constructor(overrides: MockFixtures = {}) {
    const supportsLibrarySave = overrides.supportsLibrarySave ?? true;
    const supportsPlaylistCreation = overrides.supportsPlaylistCreation ?? true;

    this.fixtures = {
      tracks: overrides.tracks ?? DEFAULT_TRACKS.map((t) => ({ ...t })),
      playlists: overrides.playlists ?? DEFAULT_PLAYLISTS.map((p) => ({ ...p })),
      userId: overrides.userId ?? 'mock-user',
      authenticated: overrides.authenticated ?? true,
      supportsLibrarySave,
      supportsPlaylistCreation,
      likedTrackIds: overrides.likedTrackIds ?? new Set<string>(),
      currentTrack: overrides.currentTrack ?? null,
    };

    this.capabilities = {
      requiresExplicitFollow: false,
      supportsSeek: true,
      requiresPremium: false,
      supportsLibrarySave,
      supportsPlaylistCreation,
      canReadUnownedPlaylists: true,
    };
  }

  async isAuthenticated(): Promise<boolean> {
    return this.fixtures.authenticated;
  }

  async refreshAuth(): Promise<void> {
    // no-op
  }

  async getUserId(): Promise<string> {
    return this.fixtures.userId;
  }

  async getUserProfile(): Promise<UserProfile> {
    return { spotifyId: this.fixtures.userId, displayName: 'Mock User', avatarUrl: null, email: null };
  }

  async getUserPlaylists(): Promise<Playlist[]> {
    return [...this.fixtures.playlists];
  }

  async getPlaylistById(playlistId: string): Promise<Playlist> {
    const playlist = this.fixtures.playlists.find((p) => p.id === playlistId);
    if (!playlist) {
      throw new PlatformError(PlatformErrorCode.NOT_FOUND, `Playlist not found: ${playlistId}`);
    }
    return { ...playlist };
  }

  async getPlaylistTracks(
    playlistId: string,
    offset: number = 0,
    limit: number = 50,
  ): Promise<{ tracks: Track[]; total: number }> {
    const allTracks = this.fixtures.tracks;
    const sliced = allTracks.slice(offset, offset + limit);
    return { tracks: sliced.map((t) => ({ ...t })), total: allTracks.length };
  }

  async play(trackUri: string): Promise<void> {
    this.lastPlayedUri = trackUri;
    this.calls.play.push(trackUri);
  }

  async pause(): Promise<void> {
    // no-op
  }

  async seek(positionMs: number): Promise<void> {
    this.lastSeekPositionMs = positionMs;
    this.calls.seek.push(positionMs);
  }

  async getCurrentTrack(): Promise<Track | null> {
    // Defaults to null to match SpotifyAdapter's default; tests opt in via the
    // currentTrack fixture.
    return this.fixtures.currentTrack;
  }

  async getCurrentPositionMs(): Promise<number> {
    return this.lastSeekPositionMs;
  }

  async addToPlaylist(playlistId: string, trackId: string): Promise<void> {
    if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
      await this.saveToLibrary(trackId);
      this.calls.addToPlaylist.push({ playlistId, trackId });
      return;
    }
    const exists = this.fixtures.playlists.some((p) => p.id === playlistId);
    if (!exists) {
      throw new PlatformError(PlatformErrorCode.NOT_FOUND, `Playlist not found: ${playlistId}`);
    }
    this.calls.addToPlaylist.push({ playlistId, trackId });
    const set = this.playlistContents.get(playlistId) ?? new Set<string>();
    set.add(trackId);
    this.playlistContents.set(playlistId, set);
  }

  async removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
      await this.removeFromLibrary(trackId);
      this.calls.removeFromPlaylist.push({ playlistId, trackId });
      return;
    }
    this.calls.removeFromPlaylist.push({ playlistId, trackId });
    this.playlistContents.get(playlistId)?.delete(trackId);
  }

  async saveToLibrary(trackId: string): Promise<void> {
    if (!this.fixtures.supportsLibrarySave) {
      throw new PlatformError(
        PlatformErrorCode.PERMISSION_DENIED,
        'saveToLibrary not supported by this adapter',
      );
    }
    this.fixtures.likedTrackIds.add(trackId);
    this.calls.saveToLibrary.push(trackId);
  }

  async removeFromLibrary(trackId: string): Promise<void> {
    this.fixtures.likedTrackIds.delete(trackId);
    this.calls.removeFromLibrary.push(trackId);
  }

  async isInLibrary(trackId: string): Promise<boolean> {
    this.calls.isInLibrary.push(trackId);
    return this.fixtures.likedTrackIds.has(trackId);
  }

  async getPlaylistTrackIds(playlistId: string): Promise<Set<string>> {
    this.calls.getPlaylistTrackIds.push(playlistId);
    // Return a copy so the writer's per-session cache cannot mutate fixture state.
    if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
      return new Set(this.fixtures.likedTrackIds);
    }
    return new Set(this.playlistContents.get(playlistId) ?? []);
  }

  async createPlaylist(name: string): Promise<string> {
    if (!this.fixtures.supportsPlaylistCreation) {
      throw new PlatformError(
        PlatformErrorCode.PERMISSION_DENIED,
        'createPlaylist not supported by this adapter',
      );
    }
    const id = `mock-playlist-${this.nextPlaylistId++}`;
    this.fixtures.playlists.push({
      id,
      name,
      coverArtUrl: null,
      trackCount: 0,
      isOwned: true,
      isFollowed: false,
    });
    this.calls.createPlaylist.push(name);
    return id;
  }

  async removeDuplicatesFromPlaylist(playlistId: string): Promise<number> {
    this.calls.removeDuplicatesFromPlaylist.push(playlistId);
    // playlistContents is a Set, so a mock playlist can never hold duplicate tracks.
    // There is nothing to remove — mirrors the real adapter's contract (returns the
    // number of duplicates removed) with a count of 0.
    return 0;
  }

  async openPlatformDeepLink(uri: string): Promise<void> {
    this.calls.openPlatformDeepLink.push(uri);
  }

  async openPlaylistInApp(playlistId: string): Promise<void> {
    this.calls.openPlaylistInApp.push(playlistId);
  }

  parsePlaylistReference(input: string): string | null {
    const trimmed = input.trim();

    // Mirrors the real adapter's contract using the mock reference format: a
    // mock:playlist: URI or a raw mock-playlist-<n> id.
    const uriMatch = trimmed.match(/^mock:playlist:([\w-]+)$/);
    if (uriMatch) return uriMatch[1];

    if (/^mock-playlist-\w+$/.test(trimmed)) return trimmed;

    return null;
  }
}
