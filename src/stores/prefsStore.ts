import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'system';

interface PrefsState {
  showAlbumArt: boolean;
  autoPlayPreviews: boolean;
  hapticFeedback: boolean;
  weeklyReminders: boolean;
  // When true, destination playlists are scanned for duplicate tracks at the end of
  // every session and any extras are removed automatically. Opt-in (off by default)
  // because it issues destructive removes against the user's playlists.
  autoRemoveDuplicates: boolean;
  themeMode: ThemeMode;
}

interface PrefsActions {
  setShowAlbumArt: (value: boolean) => void;
  setAutoPlayPreviews: (value: boolean) => void;
  setHapticFeedback: (value: boolean) => void;
  setWeeklyReminders: (value: boolean) => void;
  setAutoRemoveDuplicates: (value: boolean) => void;
  setThemeMode: (value: ThemeMode) => void;
}

export const usePrefsStore = create<PrefsState & PrefsActions>()(
  persist(
    (set) => ({
      // Defaults
      showAlbumArt: true,
      autoPlayPreviews: false,
      hapticFeedback: true,
      weeklyReminders: true,
      autoRemoveDuplicates: false,
      themeMode: 'system',

      setShowAlbumArt: (value) => set({ showAlbumArt: value }),
      setAutoPlayPreviews: (value) => set({ autoPlayPreviews: value }),
      setHapticFeedback: (value) => set({ hapticFeedback: value }),
      setWeeklyReminders: (value) => set({ weeklyReminders: value }),
      setAutoRemoveDuplicates: (value) => set({ autoRemoveDuplicates: value }),
      setThemeMode: (value) => set({ themeMode: value }),
    }),
    {
      name: 'prefs-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
