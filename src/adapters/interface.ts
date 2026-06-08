export enum PlatformErrorCode {
  NO_ACTIVE_DEVICE = 'NO_ACTIVE_DEVICE',
  PREMIUM_REQUIRED = 'PREMIUM_REQUIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PLAYLIST_NOT_FOUND = 'PLAYLIST_NOT_FOUND',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PlatformError';
    this.code = code;
  }
}

export interface Track {
  id: string;
  uri: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  albumArtUrl: string;
  durationMs: number;
  previewUrl: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  coverArtUrl: string | null;
  trackCount: number;
  isOwned: boolean;
  isFollowed: boolean;
}

export interface AdapterCapabilities {
  requiresExplicitFollow: boolean;
  supportsSeek: boolean;
  requiresPremium: boolean;
  supportsLibrarySave: boolean;
  supportsPlaylistCreation: boolean;
  /** False when the platform only allows reading tracks from playlists the user owns. */
  canReadUnownedPlaylists: boolean;
}

export interface UserProfile {
  spotifyId: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export interface MusicPlatformAdapter {
  readonly capabilities: AdapterCapabilities;

  isAuthenticated(): Promise<boolean>;
  refreshAuth(): Promise<void>;

  getUserId(): Promise<string>;
  getUserProfile(): Promise<UserProfile>;

  getUserPlaylists(): Promise<Playlist[]>;
  getPlaylistById(playlistId: string): Promise<Playlist>;
  getPlaylistTracks(
    playlistId: string,
    offset?: number,
    limit?: number,
  ): Promise<{ tracks: Track[]; total: number }>;

  play(trackUri: string): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getCurrentTrack(): Promise<Track | null>;
  getCurrentPositionMs(): Promise<number>;

  addToPlaylist(playlistId: string, trackId: string): Promise<void>;
  removeFromPlaylist(playlistId: string, trackId: string): Promise<void>;
  saveToLibrary(trackId: string): Promise<void>;
  removeFromLibrary(trackId: string): Promise<void>;
  isInLibrary(trackId: string): Promise<boolean>;

  /**
   * Reports whether the track is already present in the playlist. Used before a write
   * to tell a track the caller is adding apart from one the user already owned, so an
   * undo never deletes a pre-existing track. For the Liked Songs library this is
   * equivalent to isInLibrary.
   */
  isInPlaylist(playlistId: string, trackId: string): Promise<boolean>;

  createPlaylist(name: string): Promise<string>;

  /**
   * Removes duplicate entries from a playlist, keeping the first occurrence of each
   * track. Returns the number of duplicate entries removed. A no-op returning 0 for
   * the Liked Songs library, which is a set and cannot contain duplicates.
   */
  removeDuplicatesFromPlaylist(playlistId: string): Promise<number>;

  openPlatformDeepLink(uri: string): Promise<void>;
  openPlaylistInApp(playlistId: string): Promise<void>;
}

export const LIKED_SONGS_PLAYLIST_ID = 'spotify:collection:tracks';
