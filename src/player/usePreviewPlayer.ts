import { useEffect } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

/**
 * Shape returned by usePreviewPlayer.
 * All methods are safe to call regardless of whether a preview is available —
 * they become no-ops when hasPreview is false.
 */
export interface PreviewPlayerControls {
  /** Start or resume playback of the preview. No-op if hasPreview is false. */
  play: () => void;
  /** Pause playback. No-op if hasPreview is false. */
  pause: () => void;
  /**
   * Seek to an absolute position in seconds.
   * No-op if hasPreview is false.
   */
  seekTo: (seconds: number) => Promise<void>;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Total duration of the preview in seconds. */
  duration: number;
  /** Whether the player is currently playing. */
  isPlaying: boolean;
  /** Whether a valid previewUrl was supplied. */
  hasPreview: boolean;
}

/**
 * Manages playback of a 30-second track preview via expo-audio.
 *
 * When previewUrl is null the hook still returns a consistent shape with
 * no-op controls, so callers never need to null-check before calling methods.
 *
 * @param previewUrl - HTTP(S) URL for the audio preview, or null if unavailable.
 */
export function usePreviewPlayer(previewUrl: string | null): PreviewPlayerControls {
  const hasPreview = previewUrl !== null;

  // useAudioPlayer with an empty string when there is no URL — the player
  // will simply stay in an idle/unloaded state.
  const player = useAudioPlayer(previewUrl ?? '');
  const status = useAudioPlayerStatus(player);

  // Replace the audio source whenever the URL changes. The player returned by
  // useAudioPlayer is stable; we call replace() to swap in the new source.
  useEffect(() => {
    if (hasPreview && previewUrl) {
      player.replace({ uri: previewUrl });
    }
  }, [previewUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (): void => {
    if (!hasPreview) return;
    player.play();
  };

  const pause = (): void => {
    if (!hasPreview) return;
    player.pause();
  };

  const seekTo = async (seconds: number): Promise<void> => {
    if (!hasPreview) return;
    await player.seekTo(seconds);
  };

  return {
    play,
    pause,
    seekTo,
    currentTime: status.currentTime ?? 0,
    duration: status.duration ?? 0,
    isPlaying: status.playing ?? false,
    hasPreview,
  };
}
