import { PlatformError } from '../adapters/interface';
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
   * Returns a PlaybackResult when playback either started or is simply
   * unavailable for an unknown reason.
   *
   * PlatformErrors are rethrown rather than collapsed to 'none' so callers can
   * tell recoverable failures (NO_ACTIVE_DEVICE → prompt the user to open
   * Spotify) apart from fatal ones (AUTH_EXPIRED → re-auth). Only non-platform
   * errors fall through to the generic "audio unavailable" result.
   */
  async play(track: Track): Promise<PlaybackResult> {
    try {
      await this.adapter.play(track.uri);
      return { strategy: 'adapter' };
    } catch (error) {
      if (error instanceof PlatformError) throw error;
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
