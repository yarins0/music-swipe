import { useEffect, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import { useAuthStore } from '../stores/authStore';

const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
];

interface UseSpotifyAuthReturn {
  login: () => void;
  isLoading: boolean;
  error: string | null;
}

export function useSpotifyAuth(): UseSpotifyAuthReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setTokens = useAuthStore((s) => s.setTokens);

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'music-swipe' });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: SPOTIFY_CLIENT_ID,
      scopes: SCOPES,
      usePKCE: true,
      redirectUri,
    },
    discovery,
  );

  useEffect(() => {
    if (response?.type !== 'success') return;

    const exchangeCode = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const code = response.params.code;
        const codeVerifier = request?.codeVerifier;

        if (!codeVerifier) {
          throw new Error('PKCE code verifier missing');
        }

        // Exchange code for Spotify tokens
        const tokenBody = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: SPOTIFY_CLIENT_ID,
          code_verifier: codeVerifier,
        });

        const tokenResponse = await fetch(discovery.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenBody.toString(),
        });

        if (!tokenResponse.ok) {
          throw new Error('Token exchange failed');
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };

        const expiresAt = Date.now() + tokenData.expires_in * 1000;

        // Register with backend to get Supabase JWT
        const registerResponse = await fetch(`${BACKEND_URL}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spotifyAccessToken: tokenData.access_token }),
        });

        if (!registerResponse.ok) {
          throw new Error('Backend registration failed');
        }

        const { supabaseToken, userId } = (await registerResponse.json()) as {
          supabaseToken: string;
          userId: string;
        };

        await setTokens({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          supabaseToken,
          userId,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed');
      } finally {
        setIsLoading(false);
      }
    };

    exchangeCode();
    // redirectUri, request?.codeVerifier, and setTokens are stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return {
    login: () => {
      setError(null);
      promptAsync();
    },
    isLoading,
    error,
  };
}
