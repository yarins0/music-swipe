import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { useSwipeStore } from './swipeStore';
import { useSessionStore } from './sessionStore';
import { PlaylistWriter } from '../services/PlaylistWriter';

const KEYS = {
  ACCESS_TOKEN: 'spotify_access_token',
  REFRESH_TOKEN: 'spotify_refresh_token',
  EXPIRES_AT: 'spotify_expires_at',
  SUPABASE_TOKEN: 'supabase_token',
  SUPABASE_USER_ID: 'supabase_user_id',
} as const;

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  isAuthenticating: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  supabaseToken: string | null;
  userId: string | null;
}

interface AuthActions {
  initialize: () => Promise<void>;
  startAuth: () => void;
  stopAuth: () => void;
  setTokens: (tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    supabaseToken: string;
    userId: string;
  }) => Promise<void>;
  updateAccessToken: (accessToken: string, expiresAt: number, refreshToken?: string) => Promise<void>;
  updateSupabaseToken: (token: string) => Promise<void>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  isAuthenticating: false,
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  supabaseToken: null,
  userId: null,

  startAuth: () => set({ isAuthenticating: true }),
  stopAuth: () => set({ isAuthenticating: false }),

  initialize: async () => {
    try {
      const [accessToken, refreshToken, expiresAtStr, supabaseToken, userId] =
        await Promise.all([
          SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
          SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
          SecureStore.getItemAsync(KEYS.EXPIRES_AT),
          SecureStore.getItemAsync(KEYS.SUPABASE_TOKEN),
          SecureStore.getItemAsync(KEYS.SUPABASE_USER_ID),
        ]);

      const expiresAt = expiresAtStr ? Number(expiresAtStr) : null;
      const isAuthenticated = Boolean(
        accessToken && refreshToken && expiresAt && supabaseToken && userId,
      );

      set({
        isAuthenticated,
        isLoading: false,
        accessToken,
        refreshToken,
        expiresAt,
        supabaseToken,
        userId,
      });
    } catch {
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  setTokens: async ({ accessToken, refreshToken, expiresAt, supabaseToken, userId }) => {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, accessToken),
      SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refreshToken),
      SecureStore.setItemAsync(KEYS.EXPIRES_AT, String(expiresAt)),
      SecureStore.setItemAsync(KEYS.SUPABASE_TOKEN, supabaseToken),
      SecureStore.setItemAsync(KEYS.SUPABASE_USER_ID, userId),
    ]);

    set({ isAuthenticated: true, accessToken, refreshToken, expiresAt, supabaseToken, userId });
  },

  updateAccessToken: async (accessToken, expiresAt, refreshToken) => {
    const writes: Promise<void>[] = [
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, accessToken),
      SecureStore.setItemAsync(KEYS.EXPIRES_AT, String(expiresAt)),
    ];
    if (refreshToken) {
      writes.push(SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refreshToken));
    }
    await Promise.all(writes);
    set(refreshToken ? { accessToken, expiresAt, refreshToken } : { accessToken, expiresAt });
  },

  updateSupabaseToken: async (token: string) => {
    await SecureStore.setItemAsync(KEYS.SUPABASE_TOKEN, token);
    set({ supabaseToken: token });
  },

  clearAuth: async () => {
    useSwipeStore.getState().resetAll();
    useSessionStore.getState().clearSession();
    // Clear the previous user's pending PlaylistWriter state alongside the tokens,
    // so the next login's drainStoredQueue can't replay their adds (M3).
    await Promise.all([
      ...Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key)),
      PlaylistWriter.clearStoredState(),
    ]);
    set({
      isAuthenticated: false,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      supabaseToken: null,
      userId: null,
    });
  },
}));
