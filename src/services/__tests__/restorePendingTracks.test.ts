import {
  mapPendingSwipesToTracks,
  restoredSwipeToTrack,
  type PendingSwipeResponse,
  type RestoredTrackMetadata,
} from '../restorePendingTracks';

// Stub URI builder so the test never depends on a platform-specific literal.
const fallbackUri = (id: string): string => `test-uri:${id}`;

/**
 * A `track` object exactly as the backend serialises it in GET /swipes.
 * Mirrors backend/src/routes/trackResponse.ts `toTrackResponse`. This fixture
 * is the contract: if the backend renames a field, this mapper (and these
 * assertions) must change together — guarding against the C1 drift.
 */
const BACKEND_TRACK: RestoredTrackMetadata = {
  id: 'track-abc',
  spotify_track_id: 'track-abc',
  title: 'Song One',
  artist: 'Artist One',
  artists: ['Artist One', 'Feature Two'],
  album: 'Album One',
  album_art_url: 'http://art/1.jpg',
  duration_ms: 180000,
  preview_url: 'http://preview/1.mp3',
  uri: 'spotify:track:track-abc',
};

describe('restoredSwipeToTrack', () => {
  it('maps every snake_case backend field onto the internal Track shape', () => {
    const swipe: PendingSwipeResponse = { spotifyTrackId: 'track-abc', track: BACKEND_TRACK };

    const result = restoredSwipeToTrack(swipe, fallbackUri);

    expect(result).toEqual({
      id: 'track-abc',
      uri: 'spotify:track:track-abc',
      title: 'Song One',
      artist: 'Artist One',
      artists: ['Artist One', 'Feature Two'],
      album: 'Album One',
      albumArtUrl: 'http://art/1.jpg',
      durationMs: 180000,
      previewUrl: 'http://preview/1.mp3',
    });
  });

  it('does not read a `metadata` field (regression guard for C1)', () => {
    // Shape the backend never sends: metadata instead of track. The mapper must
    // ignore it entirely and fall back, proving it reads `track`, not `metadata`.
    const swipe = {
      spotifyTrackId: 'track-xyz',
      track: null,
      metadata: { title: 'Should Be Ignored' },
    } as unknown as PendingSwipeResponse;

    const result = restoredSwipeToTrack(swipe, fallbackUri);

    expect(result.title).toBe('track-xyz');
    expect(result.title).not.toBe('Should Be Ignored');
  });

  it('falls back to id-based values and the supplied uri when track is null (uncached)', () => {
    const swipe: PendingSwipeResponse = { spotifyTrackId: 'track-null', track: null };

    const result = restoredSwipeToTrack(swipe, fallbackUri);

    expect(result).toEqual({
      id: 'track-null',
      uri: 'test-uri:track-null',
      title: 'track-null',
      artist: '',
      artists: [],
      album: '',
      albumArtUrl: '',
      durationMs: 0,
      previewUrl: null,
    });
  });

  it('handles null album/art/duration/preview without producing nulls in non-nullable Track fields', () => {
    const sparse: RestoredTrackMetadata = {
      ...BACKEND_TRACK,
      album: null,
      album_art_url: null,
      duration_ms: null,
      preview_url: null,
    };
    const swipe: PendingSwipeResponse = { spotifyTrackId: 'track-abc', track: sparse };

    const result = restoredSwipeToTrack(swipe, fallbackUri);

    expect(result.album).toBe('');
    expect(result.albumArtUrl).toBe('');
    expect(result.durationMs).toBe(0);
    expect(result.previewUrl).toBeNull();
  });
});

describe('mapPendingSwipesToTracks', () => {
  it('maps a full response array, mixing cached and uncached rows', () => {
    const swipes: PendingSwipeResponse[] = [
      { spotifyTrackId: 'track-abc', track: BACKEND_TRACK },
      { spotifyTrackId: 'track-null', track: null },
    ];

    const result = mapPendingSwipesToTracks(swipes, fallbackUri);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Song One');
    expect(result[1].title).toBe('track-null');
  });

  it('returns an empty array for no swipes', () => {
    expect(mapPendingSwipesToTracks([], fallbackUri)).toEqual([]);
  });
});
