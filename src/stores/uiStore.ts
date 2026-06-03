import { create } from 'zustand';

// Ephemeral, in-memory UI coordination signals (never persisted). Used to let the swipe
// screen's "No full preview" badge ask the Settings screen to scroll to and flash the
// Auto-play Previews row. A consume-on-focus flag (rather than a router param) so a normal
// Settings open never triggers the highlight, and an already-mounted Settings tab still reacts.
interface UiState {
  pendingAutoPlayHighlight: boolean;
}

interface UiActions {
  /** Ask the Settings screen to highlight the Auto-play Previews row on its next focus. */
  requestAutoPlayHighlight: () => void;
  /** Clear the request once the Settings screen has handled it. */
  consumeAutoPlayHighlight: () => void;
}

export const useUiStore = create<UiState & UiActions>((set) => ({
  pendingAutoPlayHighlight: false,
  requestAutoPlayHighlight: () => set({ pendingAutoPlayHighlight: true }),
  consumeAutoPlayHighlight: () => set({ pendingAutoPlayHighlight: false }),
}));
