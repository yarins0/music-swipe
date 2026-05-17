import { create } from 'zustand';

interface SessionState {
  sourcePlaylistId: string | null;
  sourcePlaylistName: string | null;
  destinationPlaylistIds: string[];
}

interface SessionActions {
  setSource: (playlistId: string, playlistName: string) => void;
  setDestinations: (playlistIds: string[]) => void;
  addDestination: (playlistId: string) => void;
  removeDestination: (playlistId: string) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState & SessionActions>((set) => ({
  sourcePlaylistId: null,
  sourcePlaylistName: null,
  destinationPlaylistIds: [],

  setSource: (playlistId, playlistName) =>
    set({ sourcePlaylistId: playlistId, sourcePlaylistName: playlistName }),

  setDestinations: (playlistIds) =>
    set({ destinationPlaylistIds: playlistIds }),

  addDestination: (playlistId) =>
    set((state) => ({
      destinationPlaylistIds: state.destinationPlaylistIds.includes(playlistId)
        ? state.destinationPlaylistIds
        : [...state.destinationPlaylistIds, playlistId],
    })),

  removeDestination: (playlistId) =>
    set((state) => ({
      destinationPlaylistIds: state.destinationPlaylistIds.filter((id) => id !== playlistId),
    })),

  clearSession: () =>
    set({
      sourcePlaylistId: null,
      sourcePlaylistName: null,
      destinationPlaylistIds: [],
    }),
}));
