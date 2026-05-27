import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '@/adapters/interface';
import { useSessionStore } from '@/stores/sessionStore';

export type SwipeStatus = 'liked' | 'super_liked' | 'skipped' | 'pending';

const LIKED_HISTORY_LIMIT = 100;

export interface SwipeRecord {
  track: Track;
  status: SwipeStatus;
  destinationPlaylistIds: string[];
  destinationPlaylistNames?: string[];
  swipedAt: string; // ISO timestamp
  sessionId?: string;
  sourcePlaylistName?: string;
  // Set to true only after PlaylistWriter confirms the track was added to Liked Songs
  // by us in this session (not pre-existing). Used by history/session-end to guard
  // library removal without relying on cross-session AsyncStorage state.
  likedSongsWrittenByUs?: boolean;
}

interface SwipeState {
  // Session identity
  sessionId: string | null;
  sourcePlaylistId: string | null;

  // Card queue — NOT persisted; re-fetched on resume
  queue: Track[];
  currentIndex: number;

  // Absolute number of full-playlist tracks consumed in this session.
  // Persisted as the resume offset so tracks.slice(absoluteIndex) always starts
  // at the right position regardless of how many times the session is suspended.
  // Pending (decide-later) track swipes do NOT advance this counter.
  absoluteIndex: number;

  // Number of pending (decide-later) tracks prepended to the queue at session start.
  // Not persisted — re-set on each initSession call.
  pendingTracksCount: number;

  // Decide later — tracks re-queued for a second pass within this session
  decideQueue: Track[];

  // Undo — last 1 swipe only
  undoStack: SwipeRecord[];

  // Active destinations — session default; overridable per-track at call time
  activeDestinationIds: string[];

  // Swipes not yet confirmed by the backend (flushed on reconnect)
  pendingSyncSwipes: SwipeRecord[];

  // Permanent cross-session history of all liked/super-liked tracks.
  // Never cleared by clearSession() — accumulates across all sessions.
  likedHistory: SwipeRecord[];

  // True while the user has tabbed away mid-session; prevents unmount cleanup from wiping state
  isSuspended: boolean;
}

interface SwipeActions {
  /**
   * Start or resume a session. pendingTracks (decide-later from a previous session)
   * are prepended to the queue so they are seen first.
   * Pass isResuming=true when continuing an existing session (e.g. after tabbing away)
   * to preserve pendingSyncSwipes (history) and absoluteIndex (playlist progress).
   */
  initSession: (
    sessionId: string,
    sourcePlaylistId: string,
    queue: Track[],
    pendingTracks: Track[],
    destinationIds: string[],
    isResuming?: boolean,
  ) => void;

  /**
   * Record a committed swipe. Updates currentIndex, absoluteIndex, undoStack,
   * pendingSyncSwipes, and decideQueue (when status is 'pending').
   * destinationNames should be human-readable names parallel to destinationIds.
   */
  recordSwipe: (track: Track, status: SwipeStatus, destinationIds: string[], destinationNames?: string[]) => void;

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

  /**
   * Mark a track as having been added to Liked Songs by us this session.
   * Called by PlaylistWriter's onLibraryWritten callback after a confirmed write.
   */
  markLikedSongsWritten: (trackId: string) => void;

  /**
   * Remove a record from likedHistory (and pendingSyncSwipes) by its timestamp.
   * Called after the user explicitly removes a track from the history view.
   */
  removeFromHistory: (swipedAt: string) => void;

  /** Wipe all session state (called when the user exits the swipe screen). */
  clearSession: () => void;

  /** Mark session as suspended so unmount cleanup skips teardown. */
  suspendSession: () => void;

  /** Clear the suspended flag when re-entering the swipe screen. */
  resumeSession: () => void;
}

const INITIAL_STATE: SwipeState = {
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
  likedHistory: [],
  isSuspended: false,
};

export const useSwipeStore = create<SwipeState & SwipeActions>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      initSession: (sessionId, sourcePlaylistId, queue, pendingTracks, destinationIds, isResuming = false) =>
        set((state) => ({
          sessionId,
          sourcePlaylistId,
          // Decide-later tracks go to the front so the user sees them first
          queue: [...pendingTracks, ...queue],
          currentIndex: 0,
          // On resume: keep absoluteIndex so the next suspend/resume slices correctly.
          // On new session: reset to 0.
          absoluteIndex: isResuming ? state.absoluteIndex : 0,
          pendingTracksCount: pendingTracks.length,
          decideQueue: [],
          undoStack: [],
          activeDestinationIds: destinationIds,
          // On resume: preserve history so the History tab stays populated.
          // On new session: start fresh.
          pendingSyncSwipes: isResuming ? state.pendingSyncSwipes : [],
        })),

      recordSwipe: (track, status, destinationIds, destinationNames) => {
        const record: SwipeRecord = {
          track,
          status,
          destinationPlaylistIds: destinationIds,
          destinationPlaylistNames: destinationNames,
          swipedAt: new Date().toISOString(),
          sessionId: get().sessionId ?? undefined,
          sourcePlaylistName: useSessionStore.getState().sourcePlaylistName ?? undefined,
        };
        const isLiked = status === 'liked' || status === 'super_liked';
        set((state) => ({
          currentIndex: state.currentIndex + 1,
          // Only advance the playlist offset when consuming a regular (non-pending) track.
          // Queue positions 0..(pendingTracksCount-1) are pending tracks.
          absoluteIndex:
            state.currentIndex < state.pendingTracksCount
              ? state.absoluteIndex
              : state.absoluteIndex + 1,
          undoStack: [record], // keep only the last 1 swipe for undo
          pendingSyncSwipes: [...state.pendingSyncSwipes, record],
          likedHistory: isLiked
            ? [...state.likedHistory, record].slice(-LIKED_HISTORY_LIMIT) // cap history to most recent N liked/super-liked tracks
            : state.likedHistory,
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
          // The undone swipe was at queue position (currentIndex - 1).
          // Only reverse absoluteIndex when that position was a regular track.
          absoluteIndex:
            state.currentIndex > state.pendingTracksCount
              ? state.absoluteIndex - 1
              : state.absoluteIndex,
          undoStack: [],
          pendingSyncSwipes: state.pendingSyncSwipes.filter(
            (s) => s.swipedAt !== last.swipedAt,
          ),
          likedHistory: state.likedHistory.filter((s) => s.swipedAt !== last.swipedAt),
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

      markLikedSongsWritten: (trackId) =>
        set((state) => ({
          pendingSyncSwipes: state.pendingSyncSwipes.map((r) =>
            r.track.id === trackId ? { ...r, likedSongsWrittenByUs: true } : r,
          ),
          likedHistory: state.likedHistory.map((r) =>
            r.track.id === trackId ? { ...r, likedSongsWrittenByUs: true } : r,
          ),
        })),

      removeFromHistory: (swipedAt) =>
        set((state) => ({
          likedHistory: state.likedHistory.filter((r) => r.swipedAt !== swipedAt),
          pendingSyncSwipes: state.pendingSyncSwipes.filter((r) => r.swipedAt !== swipedAt),
        })),

      // Preserve likedHistory across session boundaries — only session-specific state is reset.
      clearSession: () =>
        set((state) => ({ ...INITIAL_STATE, likedHistory: state.likedHistory })),

      suspendSession: () => set({ isSuspended: true }),

      resumeSession: () => set({ isSuspended: false }),
    }),
    {
      name: 'swipe-store',
      storage: createJSONStorage(() => AsyncStorage),
      // queue, decideQueue, and pendingTracksCount are excluded: tracks are large and
      // re-fetched on resume. absoluteIndex replaces currentIndex as the resume offset —
      // it is an absolute playlist position, never reset on resume.
      partialize: (state) => ({
        sessionId: state.sessionId,
        sourcePlaylistId: state.sourcePlaylistId,
        absoluteIndex: state.absoluteIndex,
        activeDestinationIds: state.activeDestinationIds,
        pendingSyncSwipes: state.pendingSyncSwipes,
        likedHistory: state.likedHistory,
      }),
    },
  ),
);
