import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PrefsState {
  showAlbumArt: boolean;
  autoPlayPreviews: boolean;
  hapticFeedback: boolean;
  weeklyReminders: boolean;
}

interface PrefsActions {
  setShowAlbumArt: (value: boolean) => void;
  setAutoPlayPreviews: (value: boolean) => void;
  setHapticFeedback: (value: boolean) => void;
  setWeeklyReminders: (value: boolean) => void;
}

export const usePrefsStore = create<PrefsState & PrefsActions>()(
  persist(
    (set) => ({
      // Defaults
      showAlbumArt: true,
      autoPlayPreviews: false,
      hapticFeedback: true,
      weeklyReminders: true,

      setShowAlbumArt: (value) => set({ showAlbumArt: value }),
      setAutoPlayPreviews: (value) => set({ autoPlayPreviews: value }),
      setHapticFeedback: (value) => set({ hapticFeedback: value }),
      setWeeklyReminders: (value) => set({ weeklyReminders: value }),
    }),
    {
      name: 'prefs-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
