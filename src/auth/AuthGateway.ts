import { useAuthStore } from '../stores/authStore';
import { SpotifyAdapter } from '../adapters/spotify/SpotifyAdapter';
import type { SpotifyAuthContext } from '../adapters/spotify/spotifyFetch';
import type { MusicPlatformAdapter } from '../adapters/interface';

function createSpotifyAuthContext(): SpotifyAuthContext {
  return {
    // Getter properties so spotifyFetch always reads the latest token state from the
    // store rather than a stale snapshot. Spotify PKCE flows rotate the refresh token
    // on every refresh; without getters, the second proactive refresh within the same
    // session would use the old (now-revoked) refresh token and force a logout.
    get accessToken() { return useAuthStore.getState().accessToken ?? ''; },
    get refreshToken() { return useAuthStore.getState().refreshToken ?? ''; },
    get expiresAt() { return useAuthStore.getState().expiresAt ?? 0; },
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
