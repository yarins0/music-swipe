import type { MusicPlatformAdapter, Track } from '../adapters/interface';

/**
 * Describes which audio strategy was used when play() was called.
 * - 'adapter': platform adapter handled playback (e.g. Spotify Premium)
 * - 'none': no playback was possible (no active device)
 */
export interface PlaybackResult {
  strategy: 'adapter' | 'none';
}

/**
 * TrackPlayer orchestrates audio playback through a platform adapter.
 *
 * Spotify deprecated the `preview_url` field on its Web API tracks endpoint,
 * so the only viable playback path is the adapter itself (which requires an
 * active Spotify device). When that fails, playback is simply unavailable.
 */
export class TrackPlayer {
  private readonly adapter: MusicPlatformAdapter;

  constructor(adapter: MusicPlatformAdapter) {
    this.adapter = adapter;
  }

  /**
   * Attempts to play the given track using the adapter.
   * Returns a PlaybackResult indicating whether playback started.
   */
  async play(track: Track): Promise<PlaybackResult> {
    try {
      await this.adapter.play(track.uri);
      return { strategy: 'adapter' };
    } catch {
      return { strategy: 'none' };
    }
  }

  /**
   * Pauses playback. Errors from the adapter are swallowed so the swipe UI
   * is never blocked by a pause failure.
   */
  async pause(): Promise<void> {
    try {
      await this.adapter.pause();
    } catch {
      // Swallow — caller does not need to handle pause errors
    }
  }

  /**
   * Seeks to the given position in milliseconds.
   * Delegates to the adapter only when capabilities.supportsSeek is true.
   */
  async seekTo(positionMs: number): Promise<void> {
    if (!this.adapter.capabilities.supportsSeek) return;
    await this.adapter.seek(positionMs);
  }

  /**
   * Returns the current playback position in milliseconds via the adapter.
   * Returns 0 when the adapter does not support seeking (and therefore cannot
   * report a position) so callers can compute relative seeks without crashing.
   */
  async getCurrentPositionMs(): Promise<number> {
    if (!this.adapter.capabilities.supportsSeek) return 0;
    return this.adapter.getCurrentPositionMs();
  }
}
