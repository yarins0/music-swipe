import { useSwipeStore } from '../swipeStore';
import type { SwipeRecord } from '../swipeStore';
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

// ---------------------------------------------------------------------------
// Reset store state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useSwipeStore.setState({
    sessionId: null,
    sourcePlaylistId: null,
    queue: [],
    currentIndex: 0,
    absoluteIndex: 0,
    pendingTracksCount: 0,
    decideQueue: [],
    undoStack: [],
    activeDestinationIds: [],
    pendingSyncSwipes: [],
  });
});

// ---------------------------------------------------------------------------
// initSession
// ---------------------------------------------------------------------------

describe('initSession', () => {
  it('sets sessionId, sourcePlaylistId, activeDestinationIds, and resets counters', () => {
    useSwipeStore.getState().initSession('sess-1', 'src-playlist', [TRACK_A, TRACK_B], [], DEST_IDS);

    const state = useSwipeStore.getState();
    expect(state.sessionId).toBe('sess-1');
    expect(state.sourcePlaylistId).toBe('src-playlist');
    expect(state.activeDestinationIds).toEqual(DEST_IDS);
    expect(state.currentIndex).toBe(0);
    expect(state.undoStack).toHaveLength(0);
    expect(state.pendingSyncSwipes).toHaveLength(0);
    expect(state.decideQueue).toHaveLength(0);
  });

  it('prepends pendingTracks to the front of the queue', () => {
    useSwipeStore
      .getState()
      .initSession('sess-1', 'src', [TRACK_B, TRACK_C], [TRACK_A], DEST_IDS);

    const { queue } = useSwipeStore.getState();
    expect(queue[0].id).toBe('a'); // pending track first
    expect(queue[1].id).toBe('b');
    expect(queue[2].id).toBe('c');
  });

  it('clears any stale state from a previous session', () => {
    // Simulate leftover state
    useSwipeStore.setState({
      sessionId: 'old-sess',
      currentIndex: 5,
      absoluteIndex: 5,
      undoStack: [{ track: TRACK_A, status: 'liked', destinationPlaylistIds: [], swipedAt: '' }],
      pendingSyncSwipes: [
        { track: TRACK_A, status: 'liked', destinationPlaylistIds: [], swipedAt: '' },
      ],
    });

    useSwipeStore.getState().initSession('new-sess', 'src', [], [], []);

    const state = useSwipeStore.getState();
    expect(state.sessionId).toBe('new-sess');
    expect(state.currentIndex).toBe(0);
    expect(state.absoluteIndex).toBe(0);
    expect(state.undoStack).toHaveLength(0);
    expect(state.pendingSyncSwipes).toHaveLength(0);
  });

  it('preserves pendingSyncSwipes and absoluteIndex when isResuming=true', () => {
    const existingSwipe: SwipeRecord = {
      track: TRACK_A,
      status: 'liked',
      destinationPlaylistIds: DEST_IDS,
      swipedAt: 'ts-1',
    };
    useSwipeStore.setState({
      sessionId: 'sess-1',
      absoluteIndex: 7,
      pendingSyncSwipes: [existingSwipe],
    });

    useSwipeStore
      .getState()
      .initSession('sess-1', 'src', [TRACK_B, TRACK_C], [], DEST_IDS, true);

    const state = useSwipeStore.getState();
    expect(state.absoluteIndex).toBe(7);
    expect(state.pendingSyncSwipes).toHaveLength(1);
    expect(state.pendingSyncSwipes[0].swipedAt).toBe('ts-1');
    expect(state.currentIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// recordSwipe
// ---------------------------------------------------------------------------

describe('recordSwipe', () => {
  beforeEach(() => {
    useSwipeStore
      .getState()
      .initSession('sess-1', 'src', [TRACK_A, TRACK_B, TRACK_C], [], DEST_IDS);
  });

  it('increments currentIndex by 1', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    expect(useSwipeStore.getState().currentIndex).toBe(1);
  });

  it('stores the correct status in the swipe record', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'super_liked', DEST_IDS);
    const record = useSwipeStore.getState().undoStack[0];
    expect(record.status).toBe('super_liked');
  });

  it('stores destinationPlaylistIds in the swipe record', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    const record = useSwipeStore.getState().undoStack[0];
    expect(record.destinationPlaylistIds).toEqual(DEST_IDS);
  });

  it('adds the record to pendingSyncSwipes', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    expect(useSwipeStore.getState().pendingSyncSwipes).toHaveLength(1);
  });

  it('keeps only the last 1 swipe in undoStack', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', DEST_IDS);

    const { undoStack } = useSwipeStore.getState();
    expect(undoStack).toHaveLength(1);
    expect(undoStack[0].track.id).toBe('b'); // only the latest
  });

  it('adds track to decideQueue when status is pending', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'pending', []);
    expect(useSwipeStore.getState().decideQueue).toContainEqual(
      expect.objectContaining({ id: 'a' }),
    );
  });

  it('does NOT add track to decideQueue for non-pending statuses', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', []);
    useSwipeStore.getState().recordSwipe(TRACK_C, 'super_liked', DEST_IDS);
    expect(useSwipeStore.getState().decideQueue).toHaveLength(0);
  });

  it('accumulates multiple swipes in pendingSyncSwipes', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', []);
    expect(useSwipeStore.getState().pendingSyncSwipes).toHaveLength(2);
  });

  it('increments absoluteIndex for regular (non-pending) tracks', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    expect(useSwipeStore.getState().absoluteIndex).toBe(1);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'skipped', []);
    expect(useSwipeStore.getState().absoluteIndex).toBe(2);
  });

  it('does NOT increment absoluteIndex when swiping pending (decide-later) tracks', () => {
    // Simulate 2 pending tracks prepended to the queue
    useSwipeStore.getState().initSession('sess-1', 'src', [TRACK_C], [TRACK_A, TRACK_B], DEST_IDS);

    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS); // pending track
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
    useSwipeStore.getState().recordSwipe(TRACK_B, 'liked', DEST_IDS); // pending track
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
    useSwipeStore.getState().recordSwipe(TRACK_C, 'liked', DEST_IDS); // regular track
    expect(useSwipeStore.getState().absoluteIndex).toBe(1);
  });

  it('sets a non-empty ISO swipedAt timestamp', () => {
    const before = new Date().toISOString();
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    const after = new Date().toISOString();
    const { swipedAt } = useSwipeStore.getState().undoStack[0];
    expect(swipedAt >= before).toBe(true);
    expect(swipedAt <= after).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------

describe('undo', () => {
  beforeEach(() => {
    useSwipeStore
      .getState()
      .initSession('sess-1', 'src', [TRACK_A, TRACK_B], [], DEST_IDS);
  });

  it('returns null when undoStack is empty', () => {
    const result = useSwipeStore.getState().undo();
    expect(result).toBeNull();
  });

  it('returns the last SwipeRecord', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    const result = useSwipeStore.getState().undo();
    expect(result).not.toBeNull();
    expect((result as SwipeRecord).track.id).toBe('a');
    expect((result as SwipeRecord).status).toBe('liked');
  });

  it('decrements currentIndex by 1', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    expect(useSwipeStore.getState().currentIndex).toBe(1);
    useSwipeStore.getState().undo();
    expect(useSwipeStore.getState().currentIndex).toBe(0);
  });

  it('does not decrement currentIndex below 0', () => {
    // Force undoStack to have a record without advancing index
    useSwipeStore.setState({
      undoStack: [
        { track: TRACK_A, status: 'liked', destinationPlaylistIds: DEST_IDS, swipedAt: 'ts' },
      ],
      currentIndex: 0,
    });
    useSwipeStore.getState().undo();
    expect(useSwipeStore.getState().currentIndex).toBe(0);
  });

  it('clears the undoStack after undo', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    useSwipeStore.getState().undo();
    expect(useSwipeStore.getState().undoStack).toHaveLength(0);
  });

  it('removes the undone swipe from pendingSyncSwipes', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    const { swipedAt } = useSwipeStore.getState().undoStack[0];

    useSwipeStore.getState().undo();

    const { pendingSyncSwipes } = useSwipeStore.getState();
    expect(pendingSyncSwipes.some((s) => s.swipedAt === swipedAt)).toBe(false);
  });

  it('removes a pending track from decideQueue on undo', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'pending', []);
    expect(useSwipeStore.getState().decideQueue).toHaveLength(1);

    useSwipeStore.getState().undo();
    expect(useSwipeStore.getState().decideQueue).toHaveLength(0);
  });

  it('decrements absoluteIndex when undoing a regular track swipe', () => {
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);
    expect(useSwipeStore.getState().absoluteIndex).toBe(1);
    useSwipeStore.getState().undo();
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
  });

  it('does NOT decrement absoluteIndex when undoing a pending track swipe', () => {
    useSwipeStore.getState().initSession('sess-1', 'src', [TRACK_B], [TRACK_A], DEST_IDS);

    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS); // pending track
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
    useSwipeStore.getState().undo();
    expect(useSwipeStore.getState().absoluteIndex).toBe(0);
  });

  it('does not mutate decideQueue when undoing a non-pending swipe', () => {
    useSwipeStore.getState().recordSwipe(TRACK_B, 'pending', []);
    useSwipeStore.getState().recordSwipe(TRACK_A, 'liked', DEST_IDS);

    useSwipeStore.getState().undo(); // undoes the 'liked' swipe

    // TRACK_B's pending entry should remain
    expect(useSwipeStore.getState().decideQueue).toHaveLength(1);
    expect(useSwipeStore.getState().decideQueue[0].id).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// setActiveDestinations
// ---------------------------------------------------------------------------

describe('setActiveDestinations', () => {
  it('replaces activeDestinationIds', () => {
    useSwipeStore.setState({ activeDestinationIds: ['old-1'] });
    useSwipeStore.getState().setActiveDestinations(['new-1', 'new-2']);
    expect(useSwipeStore.getState().activeDestinationIds).toEqual(['new-1', 'new-2']);
  });

  it('accepts an empty array', () => {
    useSwipeStore.setState({ activeDestinationIds: ['old-1'] });
    useSwipeStore.getState().setActiveDestinations([]);
    expect(useSwipeStore.getState().activeDestinationIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// markSynced
// ---------------------------------------------------------------------------

describe('markSynced', () => {
  it('removes the swipe with the matching swipedAt from pendingSyncSwipes', () => {
    const record: SwipeRecord = {
      track: TRACK_A,
      status: 'liked',
      destinationPlaylistIds: DEST_IDS,
      swipedAt: '2026-05-18T10:00:00.000Z',
    };
    useSwipeStore.setState({ pendingSyncSwipes: [record] });

    useSwipeStore.getState().markSynced('2026-05-18T10:00:00.000Z');

    expect(useSwipeStore.getState().pendingSyncSwipes).toHaveLength(0);
  });

  it('keeps other swipes when removing one', () => {
    const r1: SwipeRecord = {
      track: TRACK_A,
      status: 'liked',
      destinationPlaylistIds: [],
      swipedAt: 'ts-1',
    };
    const r2: SwipeRecord = {
      track: TRACK_B,
      status: 'skipped',
      destinationPlaylistIds: [],
      swipedAt: 'ts-2',
    };
    useSwipeStore.setState({ pendingSyncSwipes: [r1, r2] });

    useSwipeStore.getState().markSynced('ts-1');

    const { pendingSyncSwipes } = useSwipeStore.getState();
    expect(pendingSyncSwipes).toHaveLength(1);
    expect(pendingSyncSwipes[0].swipedAt).toBe('ts-2');
  });

  it('is a no-op when the swipedAt does not match any pending swipe', () => {
    const record: SwipeRecord = {
      track: TRACK_A,
      status: 'liked',
      destinationPlaylistIds: [],
      swipedAt: 'ts-existing',
    };
    useSwipeStore.setState({ pendingSyncSwipes: [record] });

    useSwipeStore.getState().markSynced('ts-nonexistent');

    expect(useSwipeStore.getState().pendingSyncSwipes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clearSession
// ---------------------------------------------------------------------------

describe('clearSession', () => {
  it('resets all session state to initial values', () => {
    useSwipeStore.setState({
      sessionId: 'sess-1',
      sourcePlaylistId: 'src',
      queue: [TRACK_A],
      currentIndex: 3,
      absoluteIndex: 3,
      pendingTracksCount: 1,
      decideQueue: [TRACK_B],
      undoStack: [
        { track: TRACK_A, status: 'liked', destinationPlaylistIds: [], swipedAt: 'ts' },
      ],
      activeDestinationIds: ['p1'],
      pendingSyncSwipes: [
        { track: TRACK_A, status: 'liked', destinationPlaylistIds: [], swipedAt: 'ts' },
      ],
    });

    useSwipeStore.getState().clearSession();

    const state = useSwipeStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.sourcePlaylistId).toBeNull();
    expect(state.queue).toHaveLength(0);
    expect(state.currentIndex).toBe(0);
    expect(state.absoluteIndex).toBe(0);
    expect(state.pendingTracksCount).toBe(0);
    expect(state.decideQueue).toHaveLength(0);
    expect(state.undoStack).toHaveLength(0);
    expect(state.activeDestinationIds).toHaveLength(0);
    expect(state.pendingSyncSwipes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// persist partialize — verify excluded fields
// ---------------------------------------------------------------------------

describe('persist partialize', () => {
  it('excludes queue and decideQueue from the persisted subset', () => {
    // Access the partialize function from the store's persist options
    // by reading the __persistOptions if available, otherwise test indirectly
    // by checking that queue/decideQueue keys are absent from what persist sees.
    //
    // Zustand exposes persist state via useSwipeStore.persist.getOptions().
    // Since test env doesn't hydrate from AsyncStorage (mocked to return null),
    // we verify the partialize config by calling it directly with a full state
    // snapshot and checking the shape of the result.

    // Reconstruct a state snapshot that would be passed to partialize
    const fullState = {
      sessionId: 'sess-1',
      sourcePlaylistId: 'src',
      queue: [TRACK_A],
      currentIndex: 2,
      absoluteIndex: 2,
      pendingTracksCount: 0,
      decideQueue: [TRACK_B],
      undoStack: [] as SwipeRecord[],
      activeDestinationIds: ['p1'],
      pendingSyncSwipes: [] as SwipeRecord[],
      // Actions are also present in the store state; omit for shape test
      initSession: jest.fn(),
      recordSwipe: jest.fn(),
      undo: jest.fn(),
      setActiveDestinations: jest.fn(),
      markSynced: jest.fn(),
      clearSession: jest.fn(),
    };

    // Extract partialize from the store's persist API
    const options = (useSwipeStore as unknown as { persist: { getOptions: () => { partialize: (s: typeof fullState) => object } } }).persist.getOptions();
    const persisted = options.partialize(fullState);

    expect(persisted).not.toHaveProperty('queue');
    expect(persisted).not.toHaveProperty('decideQueue');
    expect(persisted).not.toHaveProperty('currentIndex'); // currentIndex is NOT persisted
    expect(persisted).toHaveProperty('sessionId');
    expect(persisted).toHaveProperty('absoluteIndex');    // absoluteIndex IS persisted
    expect(persisted).toHaveProperty('pendingSyncSwipes');
    expect(persisted).toHaveProperty('activeDestinationIds');
    expect(persisted).toHaveProperty('sourcePlaylistId');
  });
});
