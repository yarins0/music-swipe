import type { MusicPlatformAdapter, Track } from '../adapters/interface';

/**
 * Describes which audio strategy was used when play() was called.
 * - 'adapter': platform adapter handled playback (e.g. Spotify Premium)
 * - 'preview': fell back to the track's 30-second previewUrl via expo-audio
 * - 'none': no playback was possible (no adapter device, no preview URL)
 */
export interface PlaybackResult {
  strategy: 'adapter' | 'preview' | 'none';
}

/**
 * TrackPlayer orchestrates audio playback through a platform adapter with a
 * graceful fallback chain: adapter → preview URL → no-op.
 *
 * Callers must supply a MusicPlatformAdapter and, optionally, a callback that
 * is invoked when a preview URL fallback is needed (so the UI layer can hand
 * the URL to usePreviewPlayer).
 */
export class TrackPlayer {
  private readonly adapter: MusicPlatformAdapter;
  private readonly onPreviewRequired: ((url: string | null) => void) | null;

  /**
   * @param adapter - Platform adapter instance (e.g. SpotifyAdapter).
   * @param onPreviewRequired - Called with the track's previewUrl whenever the
   *   adapter path is unavailable. Pass null to skip the preview fallback.
   */
  constructor(
    adapter: MusicPlatformAdapter,
    onPreviewRequired: ((url: string | null) => void) | null = null,
  ) {
    this.adapter = adapter;
    this.onPreviewRequired = onPreviewRequired;
  }

  /**
   * Attempts to play the given track using the adapter first.
   * Falls back to the track's previewUrl if the adapter throws.
   * Returns a PlaybackResult indicating which strategy was used.
   */
  async play(track: Track): Promise<PlaybackResult> {
    try {
      await this.adapter.play(track.uri);
      return { strategy: 'adapter' };
    } catch {
      // Adapter playback failed — try the preview URL fallback
      if (track.previewUrl) {
        this.onPreviewRequired?.(track.previewUrl);
        return { strategy: 'preview' };
      }

      // No preview available either
      this.onPreviewRequired?.(null);
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
