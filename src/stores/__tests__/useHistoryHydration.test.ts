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

// ---------------------------------------------------------------------------
// Post-hydration flows: cancelling a restored like, and continuing a restored
// (active) session. These exercise the bug-fix contract for cancel-from-History
// on records that came from the server rather than from a live local swipe.
// ---------------------------------------------------------------------------

describe('useHistoryHydration — cancel + continue after restore', () => {
  it('keeps a cancelled like gone once the server reflects the un-like', async () => {
    // First focus: server restores a completed session with one liked track.
    global.fetch = mockFetchSessions([
      remoteSession({ likedSwipes: [remoteLiked('sw-1', 'a')] }),
    ]);
    await runHydrate();
    expect(useSwipeStore.getState().sessions[0].likedSwipes).toHaveLength(1);

    // Cancel-from-History (local half): matches.tsx removes the record locally and
    // fires BackendSync.unlikeSwipe, which flips the server row to 'skipped'.
    useSwipeStore.getState().removeSwipeFromSession('s1', 'sw-1');
    expect(useSwipeStore.getState().sessions[0].likedSwipes).toHaveLength(0);

    // Next focus: GET /sessions no longer returns the row (skipped rows are excluded
    // from likedSwipes), so the merge must not resurrect it.
    global.fetch = mockFetchSessions([
      remoteSession({ likedSwipes: [], likedCount: 0, swipedCount: 1 }),
    ]);
    await runHydrate();

    const session = useSwipeStore.getState().sessions[0];
    expect(session.sessionId).toBe('s1');
    expect(session.likedSwipes).toHaveLength(0);
  });

  it('resurrects a locally-removed like if the server still returns it (why unlikeSwipe is required)', async () => {
    // Restore + local-only removal, exactly as above.
    global.fetch = mockFetchSessions([
      remoteSession({ likedSwipes: [remoteLiked('sw-1', 'a')] }),
    ]);
    await runHydrate();
    useSwipeStore.getState().removeSwipeFromSession('s1', 'sw-1');
    expect(useSwipeStore.getState().sessions[0].likedSwipes).toHaveLength(0);

    // Re-hydrate while the server STILL lists the like (the un-like was never sent).
    // Stale-while-revalidate is local-wins but does not track deletions, so the
    // still-present remote row restores. This is the resurrection that the server
    // un-like (flip to 'skipped') prevents.
    global.fetch = mockFetchSessions([
      remoteSession({ likedSwipes: [remoteLiked('sw-1', 'a')] }),
    ]);
    await runHydrate();

    expect(useSwipeStore.getState().sessions[0].likedSwipes).toHaveLength(1);
  });

  it('continues a server-restored active session — new swipes append and advance progress', async () => {
    // Server restores an in-progress session with prior progress and one like.
    global.fetch = mockFetchSessions([
      remoteSession({
        status: 'active',
        resumeOffset: 5,
        swipedCount: 5,
        likedCount: 1,
        likedSwipes: [remoteLiked('sw-1', 'a')],
      }),
    ]);
    await runHydrate();

    const restored = useSwipeStore.getState().sessions[0];
    expect(restored.status).toBe('active');
    expect(restored.resumeOffset).toBe(5);
    expect(restored.likedSwipes).toHaveLength(1);

    // Resume it the way the swipe screen does: make it active, then set up the live
    // queue starting at its restored resumeOffset (isResuming = true).
    const store = useSwipeStore.getState();
    store.setActiveSession('s1');
    store.initSession('s1', 'src', [clientTrack('b'), clientTrack('c')], [], ['p1'], true, 7, 5);

    // Continue swiping: a fresh-track like appends to the restored history and
    // advances the session's offset/counts on top of the restored values.
    useSwipeStore.getState().recordSwipe(clientTrack('b'), 'liked', ['p1']);

    const continued = useSwipeStore.getState().sessions.find((e) => e.sessionId === 's1')!;
    expect(continued.likedSwipes.map((r) => r.track.id)).toEqual(['a', 'b']);
    expect(continued.likedCount).toBe(2);
    expect(continued.resumeOffset).toBe(6);
  });

  it('protects the restored active session from being overwritten by a later hydrate', async () => {
    // Restore an active session, resume it, and make local progress.
    global.fetch = mockFetchSessions([
      remoteSession({ status: 'active', resumeOffset: 5, likedSwipes: [remoteLiked('sw-1', 'a')] }),
    ]);
    await runHydrate();
    const store = useSwipeStore.getState();
    store.setActiveSession('s1');
    store.initSession('s1', 'src', [clientTrack('b')], [], ['p1'], true, 7, 5);
    useSwipeStore.getState().recordSwipe(clientTrack('b'), 'liked', ['p1']); // resumeOffset → 6

    // A background re-hydrate arrives with the older server state (resumeOffset 5).
    // The active session's in-flight local progress must win.
    global.fetch = mockFetchSessions([
      remoteSession({ status: 'active', resumeOffset: 5, likedSwipes: [remoteLiked('sw-1', 'a')] }),
    ]);
    await runHydrate();

    const session = useSwipeStore.getState().sessions.find((e) => e.sessionId === 's1')!;
    expect(session.resumeOffset).toBe(6);
    expect(session.likedSwipes.map((r) => r.track.id)).toEqual(['a', 'b']);
  });
});
