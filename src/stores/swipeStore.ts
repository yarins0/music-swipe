import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track, Playlist } from '@/adapters/interface';
import { useSessionStore } from '@/stores/sessionStore';
import {
  type SwipeStatus,
  type SwipeRecord,
  type SessionEntry,
  MAX_SESSION_HISTORY,
  isResumable,
} from '@/stores/sessionTypes';

// Re-export the shared session types so existing importers (`from '@/stores/swipeStore'`)
// keep working while the canonical definitions live in sessionTypes.ts.
export type { SwipeStatus, SwipeRecord, SessionEntry } from '@/stores/sessionTypes';
export { MAX_SESSION_HISTORY, isResumable } from '@/stores/sessionTypes';

/** Metadata needed to open a fresh session entry; counts/offset start at zero. */
export interface CreateSessionMeta {
  sessionId: string;
  sourcePlaylistId: string;
  sourcePlaylistName: string;
  destinationPlaylistIds: string[];
  destinationPlaylistNames: string[];
  isFilterMode: boolean;
  totalTracks: number;
}

/** Fields of the active session entry that the swipe screen refreshes on resume. */
export type ActiveSessionPatch = Partial<
  Pick<
    SessionEntry,
    | 'totalTracks'
    | 'destinationPlaylistIds'
    | 'destinationPlaylistNames'
    | 'sourcePlaylistName'
    | 'isFilterMode'
  >
>;

interface SwipeState {
  // ---- Persisted: the History stack of sessions (most-recent-first) ----
  sessions: SessionEntry[];
  // Currently-open session. null when no session is loaded (cold start / after completion).
  activeSessionId: string | null;

  // ---- Live / transient (NOT persisted) — belongs to whichever session is open ----
  // Identifies which session the live queue below currently represents. Guards the
  // in-memory fast-resume path against reusing a previous session's queue after a switch.
  liveSessionId: string | null;

  // Card queue — re-fetched on resume, never persisted.
  queue: Track[];
  currentIndex: number;

  // Absolute number of full-playlist tracks consumed in this session. Mirrors the active
  // entry's resumeOffset; SwipeEngine reads it for the progress bar.
  absoluteIndex: number;

  // Decide-later carried-over prefix length + fresh-band length (banded absoluteIndex logic).
  pendingTracksCount: number;
  freshTracksCount: number;
  // Raw source-playlist offset the next lazy page should fetch from.
  nextPageOffset: number;

  // Decide later — tracks re-queued for a second pass within this session.
  decideQueue: Track[];
  // True once the decide-later second pass has been appended (guards against a third pass).
  secondPassInjected: boolean;

  // Undo — last 1 swipe only.
  undoStack: SwipeRecord[];

  // Active destinations — session default; overridable per-track at call time.
  activeDestinationIds: string[];

  // Filter mode for the open session (mirrored on the active entry for resume).
  isFilterMode: boolean;

  // Total track count from the last getPlaylistTracks API call (live mirror of the entry).
  totalTracks: number;

  // User's playlist library — cached across remounts so the editor/subtitle work instantly.
  availablePlaylists: Playlist[];
}

interface SwipeActions {
  /**
   * Set up the LIVE queue state for the open session. pendingTracks (decide-later from a
   * previous session) are prepended so they are seen first. On resume, absoluteIndex is set
   * from resumeOffset; on a fresh session it starts at 0. Does not create the stack entry —
   * callers pair this with createSession (fresh) or setActiveSession (resume).
   */
  initSession: (
    sessionId: string,
    sourcePlaylistId: string,
    queue: Track[],
    pendingTracks: Track[],
    destinationIds: string[],
    isResuming?: boolean,
    nextPageOffset?: number,
    resumeOffset?: number,
  ) => void;

  /** Push a fresh session entry onto the stack and make it active (evicts past the cap). */
  createSession: (meta: CreateSessionMeta) => void;

  /** Make an existing session the active one (used by Discover / History resume + dedupe). */
  setActiveSession: (sessionId: string) => void;

  /** Patch metadata on the active session entry (e.g. refresh totalTracks/destinations on resume). */
  updateActiveSession: (patch: ActiveSessionPatch) => void;

  /** Mark the active session completed and clear the open-session live state. */
  completeActiveSession: () => void;

  /** Remove a session from the stack (Start-Over dedupe, per-card delete). Clears live state if active. */
  deleteSession: (sessionId: string) => void;

  /** Remove one liked track from a session's history (post-removal from its playlist). */
  removeSwipeFromSession: (sessionId: string, swipedAt: string) => void;

  /**
   * Append a lazily-fetched page of fresh source-playlist tracks to the queue. Grows
   * freshTracksCount and the paging cursor; leaves currentIndex/absoluteIndex untouched.
   */
  appendFreshTracks: (tracks: Track[], nextPageOffset: number) => void;

  /**
   * Append the decide-later tracks to the queue for a within-session second pass (suffix band,
   * does not bump freshTracksCount). Clears decideQueue + undoStack and marks it injected once.
   */
  injectSecondPass: () => void;

  /**
   * Record a committed swipe: advances the live queue + banded absoluteIndex and syncs the
   * active session entry (counts, resumeOffset, likedSwipes for liked/super_liked).
   */
  recordSwipe: (track: Track, status: SwipeStatus, destinationIds: string[], destinationNames?: string[]) => void;

  /** Undo the most recent swipe (reverses live state + active entry). Returns the undone record. */
  undo: () => SwipeRecord | null;

  /** Replace the active destination list for the remainder of this session. */
  setActiveDestinations: (destinationIds: string[]) => void;

  /** Flag a track in the active session's history as added to Liked Songs by us this session. */
  markLikedSongsWritten: (trackId: string) => void;

  /** Clear the entire session history stack + any open-session live state (keeps the cached library). */
  clearAllSessions: () => void;

  /** Wipe all state including the session stack — called on logout for user isolation. */
  resetAll: () => void;

  /** Store the total playlist track count from the last API fetch. */
  setTotalTracks: (count: number) => void;

  /** Store the user's playlist library for instant restoration on tab-away + return. */
  setAvailablePlaylists: (playlists: Playlist[]) => void;

  /** Persist filter mode flag for the open session. */
  setIsFilterMode: (value: boolean) => void;
}

// Live fields reset whenever no session is open (completion, deletion of the active one, logout).
const LIVE_RESET = {
  liveSessionId: null,
  queue: [] as Track[],
  currentIndex: 0,
  absoluteIndex: 0,
  pendingTracksCount: 0,
  freshTracksCount: 0,
  nextPageOffset: 0,
  decideQueue: [] as Track[],
  secondPassInjected: false,
  undoStack: [] as SwipeRecord[],
  activeDestinationIds: [] as string[],
  isFilterMode: false,
  totalTracks: 0,
};

const INITIAL_STATE: SwipeState = {
  sessions: [],
  activeSessionId: null,
  ...LIVE_RESET,
  availablePlaylists: [],
};

/**
 * Whether a queue position holds a fresh source-playlist track (the only band that advances
 * absoluteIndex). Queue layout: [carried pending][fresh playlist][second-pass re-shows].
 */
function isFreshPlaylistPosition(
  index: number,
  pendingTracksCount: number,
  freshTracksCount: number,
): boolean {
  return index >= pendingTracksCount && index < pendingTracksCount + freshTracksCount;
}

/** Apply a patch to the active session entry, returning a new sessions array. */
function patchActiveEntry(
  sessions: SessionEntry[],
  activeSessionId: string | null,
  patch: (entry: SessionEntry) => SessionEntry,
): SessionEntry[] {
  if (!activeSessionId) return sessions;
  return sessions.map((entry) => (entry.sessionId === activeSessionId ? patch(entry) : entry));
}

/**
 * Trim the stack to MAX_SESSION_HISTORY. Never evicts the protected (active) session; drops
 * completed sessions before in-progress ones, oldest (by updatedAt) first within each group.
 */
function evictToCap(sessions: SessionEntry[], protectId: string | null): SessionEntry[] {
  if (sessions.length <= MAX_SESSION_HISTORY) return sessions;
  const removable = sessions
    .filter((entry) => entry.sessionId !== protectId)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'completed' ? -1 : 1; // completed first
      return a.updatedAt.localeCompare(b.updatedAt); // older first
    });
  const dropIds = new Set(
    removable.slice(0, sessions.length - MAX_SESSION_HISTORY).map((entry) => entry.sessionId),
  );
  return sessions.filter((entry) => !dropIds.has(entry.sessionId));
}

export const useSwipeStore = create<SwipeState & SwipeActions>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      initSession: (sessionId, _sourcePlaylistId, queue, pendingTracks, destinationIds, isResuming = false, nextPageOffset = 0, resumeOffset = 0) =>
        set({
          liveSessionId: sessionId,
          // Decide-later tracks go to the front so the user sees them first.
          queue: [...pendingTracks, ...queue],
          currentIndex: 0,
          // On resume: start the offset at the entry's stored resumeOffset; fresh starts at 0.
          absoluteIndex: isResuming ? resumeOffset : 0,
          pendingTracksCount: pendingTracks.length,
          freshTracksCount: queue.length,
          nextPageOffset,
          decideQueue: [],
          secondPassInjected: false,
          undoStack: [],
          activeDestinationIds: destinationIds,
        }),

      createSession: (meta) =>
        set((state) => {
          const now = new Date().toISOString();
          const entry: SessionEntry = {
            sessionId: meta.sessionId,
            sourcePlaylistId: meta.sourcePlaylistId,
            sourcePlaylistName: meta.sourcePlaylistName,
            destinationPlaylistIds: meta.destinationPlaylistIds,
            destinationPlaylistNames: meta.destinationPlaylistNames,
            isFilterMode: meta.isFilterMode,
            resumeOffset: 0,
            totalTracks: meta.totalTracks,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            swipedCount: 0,
            likedCount: 0,
            superLikedCount: 0,
            likedSwipes: [],
          };
          const withoutDup = state.sessions.filter((e) => e.sessionId !== entry.sessionId);
          return {
            sessions: evictToCap([entry, ...withoutDup], entry.sessionId),
            activeSessionId: entry.sessionId,
          };
        }),

      setActiveSession: (sessionId) =>
        set((state) => ({
          activeSessionId: sessionId,
          // Bump updatedAt so the resumed session sorts as most-recent in History.
          sessions: state.sessions.map((e) =>
            e.sessionId === sessionId ? { ...e, updatedAt: new Date().toISOString() } : e,
          ),
        })),

      updateActiveSession: (patch) =>
        set((state) => ({
          sessions: patchActiveEntry(state.sessions, state.activeSessionId, (e) => ({
            ...e,
            ...patch,
            updatedAt: new Date().toISOString(),
          })),
        })),

      completeActiveSession: () =>
        set((state) => ({
          sessions: patchActiveEntry(state.sessions, state.activeSessionId, (e) => ({
            ...e,
            status: 'completed',
            updatedAt: new Date().toISOString(),
          })),
          activeSessionId: null,
          ...LIVE_RESET,
        })),

      deleteSession: (sessionId) =>
        set((state) => {
          const sessions = state.sessions.filter((e) => e.sessionId !== sessionId);
          if (state.activeSessionId === sessionId) {
            return { sessions, activeSessionId: null, ...LIVE_RESET };
          }
          return { sessions };
        }),

      removeSwipeFromSession: (sessionId, swipedAt) =>
        set((state) => ({
          sessions: state.sessions.map((e) => {
            if (e.sessionId !== sessionId) return e;
            const removed = e.likedSwipes.find((s) => s.swipedAt === swipedAt);
            if (!removed) return e;
            return {
              ...e,
              likedSwipes: e.likedSwipes.filter((s) => s.swipedAt !== swipedAt),
              likedCount: removed.status === 'liked' ? Math.max(0, e.likedCount - 1) : e.likedCount,
              superLikedCount:
                removed.status === 'super_liked' ? Math.max(0, e.superLikedCount - 1) : e.superLikedCount,
            };
          }),
        })),

      appendFreshTracks: (tracks, nextPageOffset) =>
        set((state) => ({
          queue: [...state.queue, ...tracks],
          freshTracksCount: state.freshTracksCount + tracks.length,
          nextPageOffset,
        })),

      injectSecondPass: () =>
        set((state) => {
          if (state.secondPassInjected || state.decideQueue.length === 0) return state;
          return {
            // Re-shows go to the suffix band — freshTracksCount stays put so these positions
            // are not "fresh playlist" and won't advance absoluteIndex.
            queue: [...state.queue, ...state.decideQueue],
            decideQueue: [],
            secondPassInjected: true,
            // Undo across the pass boundary is disabled (it would desync the materialized suffix).
            undoStack: [],
          };
        }),

      recordSwipe: (track, status, destinationIds, destinationNames) => {
        const record: SwipeRecord = {
          track,
          status,
          destinationPlaylistIds: destinationIds,
          destinationPlaylistNames: destinationNames,
          swipedAt: new Date().toISOString(),
          sessionId: get().activeSessionId ?? undefined,
          sourcePlaylistName: useSessionStore.getState().sourcePlaylistName ?? undefined,
        };
        const isLiked = status === 'liked' || status === 'super_liked';
        set((state) => {
          // Advance the source-playlist offset only when the swiped card is a fresh playlist
          // track (state.currentIndex is the position of the card being swiped).
          const advancesOffset = isFreshPlaylistPosition(
            state.currentIndex,
            state.pendingTracksCount,
            state.freshTracksCount,
          );
          const newAbsolute = advancesOffset ? state.absoluteIndex + 1 : state.absoluteIndex;
          return {
            currentIndex: state.currentIndex + 1,
            absoluteIndex: newAbsolute,
            undoStack: [record], // keep only the last 1 swipe for undo
            // Only collect decide-later tracks during the first pass — a re-deferral after the
            // second pass is injected is backend-only and must not seed a third pass.
            decideQueue:
              status === 'pending' && !state.secondPassInjected
                ? [...state.decideQueue, track]
                : state.decideQueue,
            sessions: patchActiveEntry(state.sessions, state.activeSessionId, (e) => ({
              ...e,
              resumeOffset: newAbsolute,
              updatedAt: record.swipedAt,
              swipedCount: e.swipedCount + 1,
              likedCount: status === 'liked' ? e.likedCount + 1 : e.likedCount,
              superLikedCount: status === 'super_liked' ? e.superLikedCount + 1 : e.superLikedCount,
              likedSwipes: isLiked ? [...e.likedSwipes, record] : e.likedSwipes,
            })),
          };
        });
      },

      undo: () => {
        const { undoStack } = get();
        if (undoStack.length === 0) return null;
        const [last] = undoStack;
        const wasLiked = last.status === 'liked' || last.status === 'super_liked';
        set((state) => {
          // The undone swipe was at queue position (currentIndex - 1). Reverse the offset only
          // when that position was a fresh playlist track — mirrors recordSwipe's banded rule.
          const reversesOffset = isFreshPlaylistPosition(
            state.currentIndex - 1,
            state.pendingTracksCount,
            state.freshTracksCount,
          );
          const newAbsolute = reversesOffset ? state.absoluteIndex - 1 : state.absoluteIndex;
          return {
            currentIndex: Math.max(0, state.currentIndex - 1),
            absoluteIndex: newAbsolute,
            undoStack: [],
            decideQueue:
              last.status === 'pending'
                ? state.decideQueue.filter((t) => t.id !== last.track.id)
                : state.decideQueue,
            sessions: patchActiveEntry(state.sessions, state.activeSessionId, (e) => ({
              ...e,
              resumeOffset: newAbsolute,
              swipedCount: Math.max(0, e.swipedCount - 1),
              likedCount: last.status === 'liked' ? Math.max(0, e.likedCount - 1) : e.likedCount,
              superLikedCount:
                last.status === 'super_liked' ? Math.max(0, e.superLikedCount - 1) : e.superLikedCount,
              likedSwipes: wasLiked
                ? e.likedSwipes.filter((s) => s.swipedAt !== last.swipedAt)
                : e.likedSwipes,
            })),
          };
        });
        return last;
      },

      setActiveDestinations: (destinationIds) =>
        set((state) => ({
          activeDestinationIds: destinationIds,
          sessions: patchActiveEntry(state.sessions, state.activeSessionId, (e) => ({
            ...e,
            destinationPlaylistIds: destinationIds,
          })),
        })),

      markLikedSongsWritten: (trackId) =>
        set((state) => ({
          sessions: patchActiveEntry(state.sessions, state.activeSessionId, (e) => ({
            ...e,
            likedSwipes: e.likedSwipes.map((r) =>
              r.track.id === trackId ? { ...r, likedSongsWrittenByUs: true } : r,
            ),
          })),
        })),

      clearAllSessions: () => set({ sessions: [], activeSessionId: null, ...LIVE_RESET }),

      resetAll: () => set({ ...INITIAL_STATE }),

      // Live-only — does NOT patch the active entry. The entry's totalTracks is set
      // authoritatively by createSession / updateActiveSession in the screen's open phase.
      // (fetchQueue calls this before a fresh session is created, when activeSessionId may
      // still point at a different session that must not be touched.)
      setTotalTracks: (count) => set({ totalTracks: count }),

      setAvailablePlaylists: (playlists) => set({ availablePlaylists: playlists }),

      setIsFilterMode: (value) =>
        set((state) => ({
          isFilterMode: value,
          sessions: patchActiveEntry(state.sessions, state.activeSessionId, (e) => ({
            ...e,
            isFilterMode: value,
          })),
        })),
    }),
    {
      name: 'swipe-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the durable session stack is persisted. Live queue state (queue, currentIndex,
      // absoluteIndex, decideQueue, banding/paging) is re-derived on resume from the active
      // entry's resumeOffset + a fresh playlist fetch.
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);

/** The currently-open session entry, or null when none is loaded. */
export function useActiveSession(): SessionEntry | null {
  return useSwipeStore((s) => s.sessions.find((e) => e.sessionId === s.activeSessionId) ?? null);
}

/** Most-recently-updated resumable session, or null. Drives the Discover-tab resume. */
export function getMostRecentResumableSession(): SessionEntry | null {
  const { sessions } = useSwipeStore.getState();
  const resumable = sessions.filter(isResumable);
  if (resumable.length === 0) return null;
  return resumable.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));
}
