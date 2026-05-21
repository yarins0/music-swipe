import { useAuthStore } from '../stores/authStore';
import { SpotifyAdapter } from '../adapters/spotify/SpotifyAdapter';
import type { SpotifyAuthContext } from '../adapters/spotify/spotifyFetch';
import type { MusicPlatformAdapter } from '../adapters/interface';

function createSpotifyAuthContext(): SpotifyAuthContext {
  const state = useAuthStore.getState();

  return {
    accessToken: state.accessToken ?? '',
    refreshToken: state.refreshToken ?? '',
    expiresAt: state.expiresAt ?? 0,
    onTokenRefreshed: async (newToken, newExpiresAt, newRefreshToken) => {
      await useAuthStore.getState().updateAccessToken(newToken, newExpiresAt, newRefreshToken);
    },
    onAuthExpired: async () => {
      await useAuthStore.getState().clearAuth();
    },
  };
}

export function createSpotifyAdapter(): MusicPlatformAdapter {
  const authContext = createSpotifyAuthContext();
  return new SpotifyAdapter(authContext);
}
