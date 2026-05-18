import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '@/adapters/interface';

export type SwipeStatus = 'liked' | 'super_liked' | 'skipped' | 'pending';

export interface SwipeRecord {
  track: Track;
  status: SwipeStatus;
  destinationPlaylistIds: string[];
  swipedAt: string; // ISO timestamp
}

interface SwipeState {
  // Session identity
  sessionId: string | null;
  sourcePlaylistId: string | null;

  // Card queue — NOT persisted; re-fetched on resume
  queue: Track[];
  currentIndex: number;

  // Decide later — tracks re-queued for a second pass within this session
  decideQueue: Track[];

  // Undo — last 1 swipe only
  undoStack: SwipeRecord[];

  // Active destinations — session default; overridable per-track at call time
  activeDestinationIds: string[];

  // Swipes not yet confirmed by the backend (flushed on reconnect)
  pendingSyncSwipes: SwipeRecord[];
}

interface SwipeActions {
  /**
   * Start or resume a session. pendingTracks (decide-later from a previous session)
   * are prepended to the queue so they are seen first.
   */
  initSession: (
    sessionId: string,
    sourcePlaylistId: string,
    queue: Track[],
    pendingTracks: Track[],
    destinationIds: string[],
  ) => void;

  /**
   * Record a committed swipe. Updates currentIndex, undoStack, pendingSyncSwipes,
   * and decideQueue (when status is 'pending').
   */
  recordSwipe: (track: Track, status: SwipeStatus, destinationIds: string[]) => void;

  /**
   * Undo the most recent swipe. Returns the undone record so callers can reverse
   * playlist writes, or null when the undo stack is empty.
   */
  undo: () => SwipeRecord | null;

  /** Replace the active destination list for the remainder of this session. */
  setActiveDestinations: (destinationIds: string[]) => void;

  /**
   * Remove a synced swipe from pendingSyncSwipes, identified by its ISO timestamp.
   * Called after a successful POST /swipes.
   */
  markSynced: (swipedAt: string) => void;

  /** Wipe all session state (called when the user exits the swipe screen). */
  clearSession: () => void;
}

const INITIAL_STATE: SwipeState = {
  sessionId: null,
  sourcePlaylistId: null,
  queue: [],
  currentIndex: 0,
  decideQueue: [],
  undoStack: [],
  activeDestinationIds: [],
  pendingSyncSwipes: [],
};

export const useSwipeStore = create<SwipeState & SwipeActions>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      initSession: (sessionId, sourcePlaylistId, queue, pendingTracks, destinationIds) =>
        set({
          sessionId,
          sourcePlaylistId,
          // Decide-later tracks go to the front so the user sees them first
          queue: [...pendingTracks, ...queue],
          currentIndex: 0,
          decideQueue: [],
          undoStack: [],
          activeDestinationIds: destinationIds,
          pendingSyncSwipes: [],
        }),

      recordSwipe: (track, status, destinationIds) => {
        const record: SwipeRecord = {
          track,
          status,
          destinationPlaylistIds: destinationIds,
          swipedAt: new Date().toISOString(),
        };
        set((state) => ({
          currentIndex: state.currentIndex + 1,
          undoStack: [record], // keep only the last 1 swipe for undo
          pendingSyncSwipes: [...state.pendingSyncSwipes, record],
          decideQueue:
            status === 'pending'
              ? [...state.decideQueue, track]
              : state.decideQueue,
        }));
      },

      undo: () => {
        const { undoStack } = get();
        if (undoStack.length === 0) return null;
        const [last] = undoStack;
        set((state) => ({
          currentIndex: Math.max(0, state.currentIndex - 1),
          undoStack: [],
          pendingSyncSwipes: state.pendingSyncSwipes.filter(
            (s) => s.swipedAt !== last.swipedAt,
          ),
          decideQueue:
            last.status === 'pending'
              ? state.decideQueue.filter((t) => t.id !== last.track.id)
              : state.decideQueue,
        }));
        return last;
      },

      setActiveDestinations: (destinationIds) =>
        set({ activeDestinationIds: destinationIds }),

      markSynced: (swipedAt) =>
        set((state) => ({
          pendingSyncSwipes: state.pendingSyncSwipes.filter(
            (s) => s.swipedAt !== swipedAt,
          ),
        })),

      clearSession: () => set(INITIAL_STATE),
    }),
    {
      name: 'swipe-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Queue and decideQueue are excluded: tracks are large and re-fetched on resume.
      // The currentIndex lets the queue re-fetch start at the right position.
      partialize: (state) => ({
        sessionId: state.sessionId,
        sourcePlaylistId: state.sourcePlaylistId,
        currentIndex: state.currentIndex,
        activeDestinationIds: state.activeDestinationIds,
        pendingSyncSwipes: state.pendingSyncSwipes,
      }),
    },
  ),
);
