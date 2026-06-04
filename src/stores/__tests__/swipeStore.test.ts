import { useSwipeStore, getMostRecentResumableSession } from '../swipeStore';
import { isResumable, MAX_SESSION_HISTORY, type SwipeRecord, type CreateSessionMeta } from '../swipeStore';
import type { Track } from '@/adapters/interface';

// Zustand persist uses AsyncStorage; mock it so tests are synchronous
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
const DEST_IDS = ['playlist-1', 'playlist-2'];

function meta(overrides: Partial<CreateSessionMeta> = {}): CreateSessionMeta {
  return {
    sessionId: 'sess-1',
    sourcePlaylistId: 'src',
    sourcePlaylistName: 'Source',
    destinationPlaylistIds: DEST_IDS,
    destinationPlaylistNames: ['Dest 1', 'Dest 2'],
    isFilterMode: false,
    totalTracks: 100,
    ...overrides,
  };
}

/** Create the active session entry AND set up the live queue (the screen does both). */
function startSession(queue: Track[], pending: Track[] = [], totalTracks = 100, nextPageOffset = 0): void {
  useSwipeStore.getState().createSession(meta({ totalTracks }));
  useSwipeStore.getState().initSession('sess-1', 'src', queue, pending, DEST_IDS, false, nextPageOffset);
}

function activeEntry() {
  const s = useSwipeStore.getState();
  return s.sessions.find((e) => e.sessionId === s.activeSessionId)!;
}

beforeEach(() => {
  useSwipeStore.getState().resetAll();
});

// ---------------------------------------------------------------------------
// createSession + the stack
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('pushes an active entry and sets it as the active session', () => {
    useSwipeStore.getState().createSession(meta());
    const state = useSwipeStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe('sess-1');
    const entry = state.sessions[0];
    expect(entry.status).toBe('active');
    expect(entry.resumeOffset).toBe(0);
    expect(entry.swipedCount).toBe(0);
    expect(entry.likedSwipes).toHaveLength(0);
    expect(entry.totalTracks).toBe(100);
  });

  it('replaces an existing entry with the same sessionId rather than duplicating', () => {
    useSwipeStore.getState().createSession(meta({ totalTracks: 100 }));
    useSwipeStore.getState().createSession(meta({ totalTracks: 250 }));
    const { sessions } = useSwipeStore.getState();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].totalTracks).toBe(250);
  });

  it('evicts the oldest completed session when exceeding MAX_SESSION_HISTORY', () => {
    jest.useFakeTimers();
    try {
      // Fill the stack to the cap, all completed, with strictly-increasing updatedAt.
      for (let i = 0; i < MAX_SESSION_HISTORY; i++) {
        jest.setSystemTime(new Date(2026, 0, 1, 0, 0, i));
        useSwipeStore.getState().createSession(meta({ sessionId: `old-${i}`, sourcePlaylistId: `p${i}` }));
        useSwipeStore.getState().completeActiveSession();
      }
      expect(useSwipeStore.getState().sessions).toHaveLength(MAX_SESSION_HISTORY);

      // One more pushes past the cap → the oldest completed entry (old-0) is evicted.
      jest.setSystemTime(new Date(2026, 0, 1, 1, 0, 0));
      useSwipeStore.getState().createSession(meta({ sessionId: 'newest', sourcePlaylistId: 'pn' }));
      const ids = useSwipeStore.getState().sessions.map((e) => e.sessionId);
      expect(ids).toHaveLength(MAX_SESSION_HISTORY);
      expect(ids).toContain('newest');
      expect(ids).not.toContain('old-0');
    } finally {
      jest.useRealTimers();
    }
  });

  it('never evicts the active session', () => {
    for (let i = 0; i < MAX_SESSION_HISTORY + 2; i++) {
      useSwipeStore.getState().createSession(meta({ sessionId: `s-${i}`, sourcePlaylistId: `p${i}` }));
    }
    const state = useSwipeStore.getState();
    expect(state.sessions).toHaveLength(MAX_SESSION_HISTORY);
    // The last-created session is active and must survive eviction.
    expect(state.sessions.some((e) => e.sessionId === state.activeSessionId)).toBe(true);
    expect(state.activeSessionId).toBe(`s-${MAX_SESSION_HISTORY + 1}`);
  });
});

// ---------------------------------------------------------------------------
// initSession (live queue setup)
// ---------------------------------------------------------------------------

describe('initSession', () => {
  it('sets up the live queue, liveSessionId, and resets counters', () => {
    useSwipeStore.getState().createSession(meta());
    useSwipeStore.getState().initSession('sess-1', 'src', [TRACK_A, TRACK_B], [], DEST_IDS);
    const state = useSwipeStore.getState();
    expect(state.queue.map((t) => t.id)).toEqual(['a', 'b']);
    expect(state.liveSessionId).toBe('sess-1');
    expect(state.currentIndex).toBe(0);
    expect(state.activeDestinationIds).toEqual(DEST_IDS);
    expect(state.undoStack).toHaveLength(0);
  });

  it('prepends pendingTracks to the front of the queue', () => {
    startSession([TRACK_B, TRACK_C], [TRACK_A]);
    expect(useSwipeStore.getState().queue.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sets absoluteIndex from resumeOffset only when resuming', () => {
    useSwipeStore.getState().createSession(meta());
    useSwipeStore.getState().initSession('sess-1', 'src', [TRACK_A], [], DEST_IDS, true, 0, 7);
    expect(useSwipeStore.getState().absoluteIndex).toBe(7);

    useSwipeStore.getState().initSession('sess-1', 'src', [TRACK_A], [], DEST_IDS, false, 0, 7);
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// recordSwipe (live state + active entry sync)
// ---------------------------------------------------------------------------

describe('recordSwipe', () => {
  beforeEach(() => {
    startSession([TRACK_A, TRACK_B, TRACK_C]);
  });

  it('advances currentIndex and keeps only the last swipe in undoStack', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', []);
    const state = useSwipeStore.getState();
    expect(state.currentIndex).toBe(2);
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack[0].track.id).toBe('b');
  });

  it('appends liked/super_liked records to the active entry likedSwipes and bumps counts', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'super_liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_C, 'skipped', []);
    const entry = activeEntry();
    expect(entry.likedSwipes.map((r) => r.track.id)).toEqual(['a', 'b']);
    expect(entry.likedCount).toBe(1);
    expect(entry.superLikedCount).toBe(1);
    expect(entry.swipedCount).toBe(3);
  });

  it('syncs the active entry resumeOffset to absoluteIndex', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', []);
    expect(useSwipeStore.getState().absoluteIndex).toBe(2);
    expect(activeEntry().resumeOffset).toBe(2);
  });

  it('adds a pending track to decideQueue without advancing absoluteIndex (carried-over prefix)', () => {
    startSession([TRACK_C], [TRACK_A, TRACK_B]); // 2 carried-over pending + 1 fresh
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS); // pending prefix
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'pending', []); // pending prefix, re-deferred
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
    expect(useSwipeStore.getState().decideQueue).toHaveLength(1);
    useSwipeStore.getState().recordSwipe(TRACK_C, 'liked', DEST_IDS); // fresh track
    expect(useSwipeStore.getState().absoluteIndex).toBe(1);
  });

  it('does not count a pending (decide-later) swipe toward swipedCount, and undo of pending leaves it unchanged', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'pending', []);
    // Only the decided (liked) swipe counts; the decide-later deferral does not.
    expect(activeEntry().swipedCount).toBe(1);
    useSwipeStore.getState().undo(); // undo the pending swipe
    expect(activeEntry().swipedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------

describe('undo', () => {
  beforeEach(() => {
    startSession([TRACK_A, TRACK_B]);
  });

  it('returns null when undoStack is empty', () => {
    expect(useSwipeStore.getState().undo()).toBeNull();
  });

  it('reverses currentIndex, absoluteIndex, and the active entry counters', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    expect(activeEntry().likedCount).toBe(1);
    expect(activeEntry().resumeOffset).toBe(1);

    const undone = useSwipeStore.getState().undo();
    expect(undone?.track.id).toBe('a');
    const state = useSwipeStore.getState();
    expect(state.currentIndex).toBe(0);
    expect(state.absoluteIndex).toBe(0);
    expect(activeEntry().likedCount).toBe(0);
    expect(activeEntry().swipedCount).toBe(0);
    expect(activeEntry().resumeOffset).toBe(0);
    expect(activeEntry().likedSwipes).toHaveLength(0);
  });

  it('removes a pending track from decideQueue on undo', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'pending', []);
    expect(useSwipeStore.getState().decideQueue).toHaveLength(1);
    useSwipeStore.getState().undo();
    expect(useSwipeStore.getState().decideQueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// appendFreshTracks (lazy paging)
// ---------------------------------------------------------------------------

describe('appendFreshTracks', () => {
  beforeEach(() => {
    startSession([TRACK_A, TRACK_B], [], 100, 2);
  });

  it('appends tracks and grows the fresh band + paging cursor', () => {
    useSwipeStore.getState().appendFreshTracks([TRACK_C], 4);
    const state = useSwipeStore.getState();
    expect(state.queue.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(state.nextPageOffset).toBe(4);
    expect(state.freshTracksCount).toBe(3);
  });

  it('does NOT move currentIndex or absoluteIndex', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().appendFreshTracks([TRACK_C], 4);
    expect(useSwipeStore.getState().currentIndex).toBe(1);
    expect(useSwipeStore.getState().absoluteIndex).toBe(1);
  });

  it('advances absoluteIndex when a lazily-appended track is later swiped', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', []);
    useSwipeStore.getState().appendFreshTracks([TRACK_C], 4);
    useSwipeStore.getState().recordSwipe(TRACK_C, 'liked', DEST_IDS);
    expect(useSwipeStore.getState().absoluteIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// injectSecondPass (decide-later within-session second pass)
// ---------------------------------------------------------------------------

describe('injectSecondPass', () => {
  beforeEach(() => {
    startSession([TRACK_A, TRACK_B]);
  });

  it('appends decideQueue tracks as a suffix band and clears decideQueue + undoStack', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'pending', []);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'liked', DEST_IDS);
    useSwipeStore.getState().injectSecondPass();
    const state = useSwipeStore.getState();
    expect(state.queue.map((t) => t.id)).toEqual(['a', 'b', 'a']);
    expect(state.decideQueue).toHaveLength(0);
    expect(state.secondPassInjected).toBe(true);
    expect(state.undoStack).toHaveLength(0);
  });

  it('is a no-op when decideQueue is empty', () => {
    useSwipeStore.getState().injectSecondPass();
    expect(useSwipeStore.getState().secondPassInjected).toBe(false);
  });

  it('does not advance absoluteIndex when a re-shown track is swiped in the second pass', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'pending', []);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', []);
    expect(useSwipeStore.getState().absoluteIndex).toBe(2);
    useSwipeStore.getState().injectSecondPass(); // queue: [a, b, a]
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS); // suffix re-show
    expect(useSwipeStore.getState().absoluteIndex).toBe(2);
    expect(useSwipeStore.getState().currentIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// session stack management
// ---------------------------------------------------------------------------

describe('setActiveSession', () => {
  it('switches the active pointer and bumps the entry updatedAt (most-recent)', () => {
    useSwipeStore.getState().createSession(meta({ sessionId: 'a', sourcePlaylistId: 'pa' }));
    useSwipeStore.getState().createSession(meta({ sessionId: 'b', sourcePlaylistId: 'pb' }));
    const beforeUpdatedAt = useSwipeStore.getState().sessions.find((e) => e.sessionId === 'a')!.updatedAt;

    useSwipeStore.getState().setActiveSession('a');
    const state = useSwipeStore.getState();
    expect(state.activeSessionId).toBe('a');
    expect(state.sessions.find((e) => e.sessionId === 'a')!.updatedAt >= beforeUpdatedAt).toBe(true);
  });
});

describe('updateActiveSession', () => {
  it('patches metadata on the active entry', () => {
    useSwipeStore.getState().createSession(meta({ totalTracks: 10 }));
    useSwipeStore.getState().updateActiveSession({ totalTracks: 42, sourcePlaylistName: 'Renamed' });
    const entry = activeEntry();
    expect(entry.totalTracks).toBe(42);
    expect(entry.sourcePlaylistName).toBe('Renamed');
  });

  it('preserves destinations when the patch does not include them (resume must not clobber dests)', () => {
    useSwipeStore.getState().createSession(meta({ destinationPlaylistIds: DEST_IDS }));
    // The resume path patches only volatile metadata — destinations stay the entry's own.
    useSwipeStore.getState().updateActiveSession({ totalTracks: 99, sourcePlaylistName: 'X' });
    expect(activeEntry().destinationPlaylistIds).toEqual(DEST_IDS);
  });
});

describe('completeActiveSession', () => {
  it('marks the active entry completed and clears the open-session live state', () => {
    startSession([TRACK_A, TRACK_B], [], 2);
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);

    useSwipeStore.getState().completeActiveSession();
    const state = useSwipeStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(state.queue).toHaveLength(0);
    expect(state.currentIndex).toBe(0);
    expect(state.liveSessionId).toBeNull();
    expect(state.sessions[0].status).toBe('completed');
    // The session and its liked tracks remain in History.
    expect(state.sessions[0].likedSwipes).toHaveLength(1);
  });
});

describe('deleteSession', () => {
  it('removes the entry and clears live state when it was active', () => {
    startSession([TRACK_A]);
    useSwipeStore.getState().deleteSession('sess-1');
    const state = useSwipeStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
    expect(state.queue).toHaveLength(0);
  });

  it('removes a non-active entry without touching live state', () => {
    useSwipeStore.getState().createSession(meta({ sessionId: 'a', sourcePlaylistId: 'pa' }));
    startSession([TRACK_A]); // sess-1 is now active
    useSwipeStore.getState().deleteSession('a');
    const state = useSwipeStore.getState();
    expect(state.sessions.map((e) => e.sessionId)).toEqual(['sess-1']);
    expect(state.activeSessionId).toBe('sess-1');
    expect(state.queue).toHaveLength(1);
  });
});

describe('removeSwipeFromSession', () => {
  it('removes one liked track and decrements the matching count', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      startSession([TRACK_A, TRACK_B]);
      useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
      jest.setSystemTime(new Date('2026-01-01T00:00:01.000Z')); // distinct swipedAt for B
      useSwipeStore.getState().recordSwipe(TRACK_B, 'super_liked', DEST_IDS);
      const swipedAt = activeEntry().likedSwipes[0].swipedAt; // A's record

      useSwipeStore.getState().removeSwipeFromSession('sess-1', swipedAt);
      const entry = activeEntry();
      expect(entry.likedSwipes.map((r) => r.track.id)).toEqual(['b']);
      expect(entry.likedCount).toBe(0);
      expect(entry.superLikedCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('setActiveDestinations', () => {
  it('updates the live list and the active entry destinations', () => {
    startSession([TRACK_A]);
    useSwipeStore.getState().setActiveDestinations(['new-1']);
    expect(useSwipeStore.getState().activeDestinationIds).toEqual(['new-1']);
    expect(activeEntry().destinationPlaylistIds).toEqual(['new-1']);
  });
});

describe('markLikedSongsWritten', () => {
  it('flags the matching liked swipe in the active entry', () => {
    startSession([TRACK_A]);
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().markLikedSongsWritten('a');
    expect(activeEntry().likedSwipes[0].likedSongsWrittenByUs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resumable selectors
// ---------------------------------------------------------------------------

describe('isResumable / getMostRecentResumableSession', () => {
  it('treats an active session with tracks left as resumable, completed as not', () => {
    useSwipeStore.getState().createSession(meta({ sessionId: 'a', sourcePlaylistId: 'pa', totalTracks: 10 }));
    expect(isResumable(activeEntry())).toBe(true);
    useSwipeStore.getState().completeActiveSession();
    expect(isResumable(useSwipeStore.getState().sessions[0])).toBe(false);
  });

  it('returns the most-recently-updated resumable session', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      useSwipeStore.getState().createSession(meta({ sessionId: 'a', sourcePlaylistId: 'pa' }));
      jest.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      useSwipeStore.getState().createSession(meta({ sessionId: 'b', sourcePlaylistId: 'pb' }));
      jest.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
      useSwipeStore.getState().setActiveSession('a'); // bumps a's updatedAt to newest
      expect(getMostRecentResumableSession()?.sessionId).toBe('a');
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null when there are no resumable sessions', () => {
    useSwipeStore.getState().createSession(meta());
    useSwipeStore.getState().completeActiveSession();
    expect(getMostRecentResumableSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resetAll + persist partialize
// ---------------------------------------------------------------------------

describe('resetAll', () => {
  it('wipes the session stack and live state', () => {
    startSession([TRACK_A]);
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().resetAll();
    const state = useSwipeStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
    expect(state.queue).toHaveLength(0);
  });
});

describe('clearAllSessions', () => {
  it('clears the whole history stack and open-session live state', () => {
    useSwipeStore.getState().createSession(meta({ sessionId: 'a', sourcePlaylistId: 'pa' }));
    useSwipeStore.getState().completeActiveSession();
    startSession([TRACK_A]);
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);

    useSwipeStore.getState().clearAllSessions();
    const state = useSwipeStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
    expect(state.queue).toHaveLength(0);
    expect(state.liveSessionId).toBeNull();
  });
});

describe('persist partialize', () => {
  it('persists only the session stack + active pointer, not the live queue', () => {
    const fullState = {
      sessions: [{ sessionId: 's' }] as unknown as SwipeRecord[],
      activeSessionId: 's',
      queue: [TRACK_A],
      currentIndex: 2,
      absoluteIndex: 2,
      liveSessionId: 's',
    };
    const options = (
      useSwipeStore as unknown as {
        persist: { getOptions: () => { partialize: (s: typeof fullState) => object } };
      }
    ).persist.getOptions();
    const persisted = options.partialize(fullState);

    expect(persisted).toHaveProperty('sessions');
    expect(persisted).toHaveProperty('activeSessionId');
    expect(persisted).not.toHaveProperty('queue');
    expect(persisted).not.toHaveProperty('currentIndex');
    expect(persisted).not.toHaveProperty('absoluteIndex');
    expect(persisted).not.toHaveProperty('liveSessionId');
  });
});
