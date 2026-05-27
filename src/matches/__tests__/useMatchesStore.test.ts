import { renderHook } from '@testing-library/react-native';
import { useSwipeStore } from '../../stores/swipeStore';
import { useMatchesStore, fetchFromBackend } from '../useMatchesStore';
import type { MatchRecord } from '../useMatchesStore';
import type { Track } from '../../adapters/interface';

// Zustand persist uses AsyncStorage; mock to avoid native module errors
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTrack(id: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    title: `Track ${id}`,
    artist: 'Artist',
    artists: ['Artist'],
    album: 'Album',
    albumArtUrl: `https://example.com/art/${id}.jpg`,
    durationMs: 180000,
    previewUrl: null,
  };
}

const TRACK_A = makeTrack('a');
const TRACK_B = makeTrack('b');
const TRACK_C = makeTrack('c');
const DEST_IDS = ['playlist-1'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSwipes(swipes: ReturnType<typeof makeSwipeRecord>[]) {
  // useMatchesStore reads from likedHistory (persisted cross-session history)
  useSwipeStore.setState({ likedHistory: swipes });
}

function makeSwipeRecord(
  track: Track,
  status: 'liked' | 'super_liked' | 'skipped' | 'pending',
  destinationPlaylistIds = DEST_IDS,
  swipedAt = new Date().toISOString(),
) {
  return { track, status, destinationPlaylistIds, swipedAt };
}

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useSwipeStore.setState({
    sessionId: null,
    sourcePlaylistId: null,
    queue: [],
    currentIndex: 0,
    decideQueue: [],
    undoStack: [],
    activeDestinationIds: [],
    pendingSyncSwipes: [],
    likedHistory: [],
  });
});

// ---------------------------------------------------------------------------
// useMatchesStore — filtering
// ---------------------------------------------------------------------------

describe('useMatchesStore', () => {
  // likedHistory only ever contains liked/super_liked records — skipped/pending
  // are filtered at the write path (recordSwipe) before reaching likedHistory.

  it('returns liked records from likedHistory', () => {
    setSwipes([makeSwipeRecord(TRACK_A, 'liked')]);

    const { result } = renderHook(() => useMatchesStore());

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].track.id).toBe('a');
    expect(result.current.matches[0].status).toBe('liked');
  });

  it('returns super_liked records from likedHistory', () => {
    setSwipes([makeSwipeRecord(TRACK_A, 'super_liked')]);

    const { result } = renderHook(() => useMatchesStore());

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].track.id).toBe('a');
    expect(result.current.matches[0].status).toBe('super_liked');
  });

  it('returns both liked and super_liked from likedHistory', () => {
    setSwipes([
      makeSwipeRecord(TRACK_A, 'liked'),
      makeSwipeRecord(TRACK_B, 'super_liked'),
    ]);

    const { result } = renderHook(() => useMatchesStore());
    const { matches } = result.current;

    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.track.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('returns empty array when store has no swipes', () => {
    const { result } = renderHook(() => useMatchesStore());
    expect(result.current.matches).toHaveLength(0);
    expect(result.current.matches).toEqual([]);
  });

  it('always returns isLoading as false', () => {
    const { result } = renderHook(() => useMatchesStore());
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MatchRecord shape
// ---------------------------------------------------------------------------

describe('MatchRecord shape', () => {
  it('maps SwipeRecord fields to the correct MatchRecord structure', () => {
    const swipedAt = '2026-05-19T12:00:00.000Z';
    setSwipes([
      { track: TRACK_A, status: 'liked', destinationPlaylistIds: DEST_IDS, swipedAt },
    ]);

    const { result } = renderHook(() => useMatchesStore());
    const record: MatchRecord = result.current.matches[0];

    expect(record.track).toEqual(TRACK_A);
    expect(record.status).toBe('liked');
    expect(record.destinationPlaylistIds).toEqual(DEST_IDS);
    expect(record.swipedAt).toBe(swipedAt);
  });

  it('preserves all track fields in the mapped MatchRecord', () => {
    setSwipes([makeSwipeRecord(TRACK_B, 'super_liked')]);

    const { result } = renderHook(() => useMatchesStore());
    const { track } = result.current.matches[0];

    expect(track.id).toBe('b');
    expect(track.uri).toBe('spotify:track:b');
    expect(track.title).toBe('Track b');
    expect(track.artist).toBe('Artist');
    expect(track.artists).toEqual(['Artist']);
    expect(track.album).toBe('Album');
    expect(track.albumArtUrl).toBe('https://example.com/art/b.jpg');
    expect(track.durationMs).toBe(180000);
    expect(track.previewUrl).toBeNull();
  });

  it('preserves multiple destination playlist IDs', () => {
    const multiDest = ['p1', 'p2', 'p3'];
    setSwipes([makeSwipeRecord(TRACK_A, 'liked', multiDest)]);

    const { result } = renderHook(() => useMatchesStore());
    expect(result.current.matches[0].destinationPlaylistIds).toEqual(multiDest);
  });
});

// ---------------------------------------------------------------------------
// fetchFromBackend
// ---------------------------------------------------------------------------

describe('fetchFromBackend', () => {
  const SESSION_ID = 'sess-123';
  const TOKEN = 'tok-abc';
  const BACKEND_URL = 'https://api.example.com';

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns MatchRecord[] for liked and super_liked items', async () => {
    const mockResponse = {
      swipes: [
        {
          track_id: 'a',
          status: 'liked',
          destination_playlist_ids: ['p1'],
          swiped_at: '2026-05-19T10:00:00.000Z',
          track: {
            id: 'a',
            uri: 'spotify:track:a',
            title: 'Track a',
            artist: 'Artist',
            artists: ['Artist'],
            album: 'Album',
            album_art_url: 'https://example.com/art/a.jpg',
            duration_ms: 180000,
            preview_url: null,
          },
        },
        {
          track_id: 'b',
          status: 'super_liked',
          destination_playlist_ids: ['p1', 'p2'],
          swiped_at: '2026-05-19T10:01:00.000Z',
          track: {
            id: 'b',
            uri: 'spotify:track:b',
            title: 'Track b',
            artist: 'Artist',
            artists: ['Artist'],
            album: 'Album',
            album_art_url: 'https://example.com/art/b.jpg',
            duration_ms: 200000,
            preview_url: null,
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as jest.Mock;

    const results = await fetchFromBackend(SESSION_ID, TOKEN, BACKEND_URL);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('liked');
    expect(results[0].track.id).toBe('a');
    expect(results[1].status).toBe('super_liked');
    expect(results[1].track.id).toBe('b');
    expect(results[1].destinationPlaylistIds).toEqual(['p1', 'p2']);
  });

  it('filters out skipped items from backend response', async () => {
    const mockResponse = {
      swipes: [
        {
          track_id: 'a',
          status: 'liked',
          destination_playlist_ids: [],
          swiped_at: '2026-05-19T10:00:00.000Z',
          track: {
            id: 'a', uri: '', title: '', artist: '', artists: [], album: '',
            album_art_url: '', duration_ms: 0, preview_url: null,
          },
        },
        {
          track_id: 'b',
          status: 'skipped',
          destination_playlist_ids: [],
          swiped_at: '2026-05-19T10:01:00.000Z',
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as jest.Mock;

    const results = await fetchFromBackend(SESSION_ID, TOKEN, BACKEND_URL);

    expect(results).toHaveLength(1);
    expect(results[0].track.id).toBe('a');
  });

  it('calls the correct URL with session_id and status params', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ swipes: [] }),
    }) as jest.Mock;

    await fetchFromBackend(SESSION_ID, TOKEN, BACKEND_URL);

    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain(`session_id=${SESSION_ID}`);
    expect(calledUrl).toContain('status=liked,super_liked');
  });

  it('sends Authorization header with Bearer token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ swipes: [] }),
    }) as jest.Mock;

    await fetchFromBackend(SESSION_ID, TOKEN, BACKEND_URL);

    const calledInit = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect((calledInit.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('throws when the backend returns a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as jest.Mock;

    await expect(fetchFromBackend(SESSION_ID, TOKEN, BACKEND_URL)).rejects.toThrow(
      'fetchFromBackend failed: 401',
    );
  });

  it('returns empty array when backend returns no swipes', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ swipes: [] }),
    }) as jest.Mock;

    const results = await fetchFromBackend(SESSION_ID, TOKEN, BACKEND_URL);
    expect(results).toHaveLength(0);
  });
});
