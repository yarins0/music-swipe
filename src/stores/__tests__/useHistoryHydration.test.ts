import { renderHook, act } from '@testing-library/react-native';
import { useSwipeStore } from '@/stores/swipeStore';
import { useHistoryHydration } from '../useHistoryHydration';
import type { SessionEntry, SwipeRecord } from '@/stores/sessionTypes';
import type { Track } from '@/adapters/interface';

// Zustand persist uses AsyncStorage; mock to avoid native module errors.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// Auth token is read via useAuthStore.getState(); a mutable mock lets each test
// vary it (prefix `mock` so the jest.mock factory may reference it).
let mockToken: string | null = 'tok-123';
jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ supabaseToken: mockToken }) },
}));

jest.mock('@/config', () => ({ BACKEND_URL: 'https://api.example.com' }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The client-side Track a successfully-mapped remote track must equal. */
function clientTrack(id: string): Track {
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

/** A `tracks` object as returned by GET /sessions (snake_case + id alias). */
function remoteTrack(id: string): Record<string, unknown> {
  return {
    id,
    spotify_track_id: id,
    title: `Track ${id}`,
    artist: 'Artist',
    artists: ['Artist'],
    album: 'Album',
    album_art_url: `https://example.com/art/${id}.jpg`,
    duration_ms: 180000,
    preview_url: null,
    uri: `spotify:track:${id}`,
  };
}

function remoteLiked(
  id: string,
  trackId: string,
  track: Record<string, unknown> | null = remoteTrack(trackId),
): Record<string, unknown> {
  return {
    id,
    spotifyTrackId: trackId,
    status: 'liked',
    swipedAt: '2026-01-01T00:00:00.000Z',
    destinationPlaylistIds: ['p1'],
    track,
  };
}

function remoteSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 's1',
    sourcePlaylistId: 'src',
    sourcePlaylistName: 'Remote Source',
    destinationPlaylistIds: ['p1'],
    destinationPlaylistNames: ['Dest'],
    isFilterMode: false,
    resumeOffset: 0,
    totalTracks: 100,
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    swipedCount: 1,
    likedCount: 1,
    superLikedCount: 0,
    likedSwipes: [],
    ...overrides,
  };
}

function localRecord(id: string, track: Track, overrides: Partial<SwipeRecord> = {}): SwipeRecord {
  return {
    id,
    track,
    status: 'liked',
    destinationPlaylistIds: ['p1'],
    swipedAt: '2026-01-01T00:00:00.000Z',
    sessionId: 's1',
    ...overrides,
  };
}

function localSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: 's1',
    sourcePlaylistId: 'src',
    sourcePlaylistName: 'Local Source',
    destinationPlaylistIds: ['p1'],
    destinationPlaylistNames: ['Dest'],
    isFilterMode: false,
    resumeOffset: 0,
    totalTracks: 100,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    swipedCount: 1,
    likedCount: 1,
    superLikedCount: 0,
    likedSwipes: [],
    ...overrides,
  };
}

function mockFetchSessions(sessions: Record<string, unknown>[]): jest.Mock {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ sessions }) });
}

async function runHydrate(): Promise<void> {
  const { result } = renderHook(() => useHistoryHydration());
  await act(async () => {
    await result.current.hydrate();
  });
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  useSwipeStore.getState().resetAll();
  mockToken = 'tok-123';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useHistoryHydration', () => {
  it('restores a session from the server when none exists locally (reinstall)', async () => {
    global.fetch = mockFetchSessions([
      remoteSession({ likedSwipes: [remoteLiked('sw-1', 'a')] }),
    ]);

    await runHydrate();

    const { sessions } = useSwipeStore.getState();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('s1');
    expect(sessions[0].likedSwipes).toHaveLength(1);
    expect(sessions[0].likedSwipes[0].id).toBe('sw-1');
    // Snake-case remote track is mapped to the internal Track shape.
    expect(sessions[0].likedSwipes[0].track).toEqual(clientTrack('a'));
  });

  it('keeps the local copy on a track-id collision and preserves likedSongsWrittenByUs', async () => {
    // Local has an un-synced record (client UUID) for track "a" with our library flag set.
    useSwipeStore.setState({
      sessions: [
        localSession({
          status: 'completed',
          updatedAt: '2026-03-01T00:00:00.000Z', // newer than remote → local fields win too
          likedSwipes: [localRecord('local-uuid', clientTrack('a'), { likedSongsWrittenByUs: true })],
        }),
      ],
      activeSessionId: null,
    });

    // Remote returns the backend twin of the same track under a different id.
    global.fetch = mockFetchSessions([
      remoteSession({ status: 'completed', likedSwipes: [remoteLiked('sw-backend', 'a')] }),
    ]);

    await runHydrate();

    const { sessions } = useSwipeStore.getState();
    expect(sessions).toHaveLength(1);
    // Deduped by track id → a single record, the local one, with its flag intact.
    expect(sessions[0].likedSwipes).toHaveLength(1);
    expect(sessions[0].likedSwipes[0].id).toBe('local-uuid');
    expect(sessions[0].likedSwipes[0].likedSongsWrittenByUs).toBe(true);
  });

  it('does not overwrite the active session fields with stale remote data', async () => {
    useSwipeStore.setState({
      sessions: [
        localSession({
          sourcePlaylistName: 'Local Source',
          resumeOffset: 10,
          status: 'active',
          updatedAt: '2026-01-01T00:00:00.000Z', // OLDER than remote
        }),
      ],
      activeSessionId: 's1',
    });

    global.fetch = mockFetchSessions([
      remoteSession({
        sourcePlaylistName: 'Remote Source',
        resumeOffset: 99,
        status: 'completed',
        updatedAt: '2026-02-01T00:00:00.000Z', // newer, but active session must still win
      }),
    ]);

    await runHydrate();

    const session = useSwipeStore.getState().sessions[0];
    expect(session.sourcePlaylistName).toBe('Local Source');
    expect(session.resumeOffset).toBe(10);
    expect(session.status).toBe('active');
  });

  it('prefers fresher remote fields for a non-active session', async () => {
    useSwipeStore.setState({
      sessions: [
        localSession({
          sourcePlaylistName: 'Local Source',
          resumeOffset: 10,
          status: 'completed',
          updatedAt: '2026-01-01T00:00:00.000Z', // older
        }),
      ],
      activeSessionId: null,
    });

    global.fetch = mockFetchSessions([
      remoteSession({
        sourcePlaylistName: 'Remote Source',
        resumeOffset: 99,
        status: 'completed',
        updatedAt: '2026-05-01T00:00:00.000Z', // fresher → wins for a non-active session
      }),
    ]);

    await runHydrate();

    const session = useSwipeStore.getState().sessions[0];
    expect(session.sourcePlaylistName).toBe('Remote Source');
    expect(session.resumeOffset).toBe(99);
  });

  it('drops a liked row with no track metadata but keeps the session', async () => {
    global.fetch = mockFetchSessions([
      remoteSession({
        likedSwipes: [remoteLiked('sw-ok', 'a'), remoteLiked('sw-null', 'b', null)],
      }),
    ]);

    await runHydrate();

    const session = useSwipeStore.getState().sessions[0];
    expect(session.sessionId).toBe('s1');
    expect(session.likedSwipes.map((r) => r.id)).toEqual(['sw-ok']);
  });

  it('does nothing when there is no auth token (local cache untouched)', async () => {
    mockToken = null;
    useSwipeStore.setState({ sessions: [localSession()], activeSessionId: null });
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await runHydrate();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSwipeStore.getState().sessions).toHaveLength(1);
  });

  it('swallows a failed request and leaves the local cache intact', async () => {
    useSwipeStore.setState({ sessions: [localSession()], activeSessionId: null });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    await runHydrate();

    // Local session survives; the failure is logged, not thrown.
    expect(useSwipeStore.getState().sessions).toHaveLength(1);
  });
});
