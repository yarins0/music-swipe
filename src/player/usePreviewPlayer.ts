import { useEffect } from 'react';

// expo-audio requires a native dev build and is not bundled in Expo Go.
// Guarding with require() prevents the module from crashing at init time,
// so the swipe screen loads regardless of build type. Preview audio is
// silently disabled when the native module is unavailable.
type AudioPlayer = {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  replace(source: { uri: string }): void;
};
type AudioStatus = { currentTime?: number; duration?: number; playing?: boolean };

let _nativeUseAudioPlayer: ((source: string) => AudioPlayer) | null = null;
let _nativeUseAudioPlayerStatus: ((player: AudioPlayer) => AudioStatus) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoAudio = require('expo-audio') as {
    useAudioPlayer: (source: string) => AudioPlayer;
    useAudioPlayerStatus: (player: AudioPlayer) => AudioStatus;
  };
  _nativeUseAudioPlayer = expoAudio.useAudioPlayer;
  _nativeUseAudioPlayerStatus = expoAudio.useAudioPlayerStatus;
} catch {
  // Native module unavailable (Expo Go or unbuilt dev client)
}

function useNoopPlayer(_source: string): AudioPlayer {
  return {
    play() {},
    pause() {},
    async seekTo(_seconds: number): Promise<void> {},
    replace(_source: { uri: string }) {},
  };
}

function useNoopPlayerStatus(_player: AudioPlayer): AudioStatus {
  return {};
}

const useAudioPlayerImpl = _nativeUseAudioPlayer ?? useNoopPlayer;
const useAudioPlayerStatusImpl = _nativeUseAudioPlayerStatus ?? useNoopPlayerStatus;

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

  const player = useAudioPlayerImpl(previewUrl ?? '');
  const status = useAudioPlayerStatusImpl(player);

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
