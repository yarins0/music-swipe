import { TrackPlayer } from '../TrackPlayer';
import {
  PlatformError,
  PlatformErrorCode,
  type MusicPlatformAdapter,
  type Track,
} from '../../adapters/interface';

const SAMPLE_TRACK: Track = {
  id: 'track-1',
  uri: 'spotify:track:1',
  title: 'Test Track',
  artist: 'Test Artist',
  artists: ['Test Artist'],
  album: 'Test Album',
  albumArtUrl: '',
  durationMs: 180000,
  previewUrl: null,
};

/**
 * Builds a TrackPlayer over an adapter whose play() behaviour is supplied by the
 * caller. Only play() is exercised here, so the rest of the adapter surface is
 * left unimplemented behind a typed cast.
 */
function createPlayerWithPlay(play: jest.Mock): TrackPlayer {
  const adapter = { play } as unknown as MusicPlatformAdapter;
  return new TrackPlayer(adapter);
}

describe('TrackPlayer.play (M6)', () => {
  it("returns strategy 'adapter' when the adapter starts playback", async () => {
    const player = createPlayerWithPlay(jest.fn().mockResolvedValue(undefined));

    const result = await player.play(SAMPLE_TRACK);

    expect(result).toEqual({ strategy: 'adapter' });
  });

  it('rethrows a recoverable PlatformError so the caller can deep-link', async () => {
    const error = new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE);
    const player = createPlayerWithPlay(jest.fn().mockRejectedValue(error));

    await expect(player.play(SAMPLE_TRACK)).rejects.toBe(error);
  });

  it('rethrows a fatal PlatformError so the caller can re-auth', async () => {
    const error = new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
    const player = createPlayerWithPlay(jest.fn().mockRejectedValue(error));

    await expect(player.play(SAMPLE_TRACK)).rejects.toBe(error);
  });

  it("collapses an unknown (non-platform) error to strategy 'none'", async () => {
    const player = createPlayerWithPlay(jest.fn().mockRejectedValue(new Error('boom')));

    const result = await player.play(SAMPLE_TRACK);

    expect(result).toEqual({ strategy: 'none' });
  });
});
