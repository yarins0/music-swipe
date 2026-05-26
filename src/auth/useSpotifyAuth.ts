import { useState } from 'react';
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
  const startAuth = useAuthStore((s) => s.startAuth);
  const stopAuth = useAuthStore((s) => s.stopAuth);

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'music-swipe' });
  //console.log('REDIRECT URI:', redirectUri); 
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: SPOTIFY_CLIENT_ID,
      scopes: SCOPES,
      usePKCE: true,
      redirectUri,
      extraParams: { show_dialog: 'true' },
    },
    discovery,
  );

  const login = async () => {
    if (!request) return;
    setError(null);
    setIsLoading(true);
    startAuth();

    try {
      const result = await promptAsync();
      //console.log('AUTH RESPONSE:', result?.type, JSON.stringify(result));

      if (result?.type !== 'success') {
        setError(result?.type === 'cancel' ? null : 'Login was dismissed');
        return;
      }

      const code = result.params.code;
      const codeVerifier = request.codeVerifier;

      if (!codeVerifier) {
        throw new Error('PKCE code verifier missing');
      }

      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: codeVerifier,
      });

      //console.log('STEP: token exchange start');
      const tokenResponse = await fetch(discovery.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

      if (!tokenResponse.ok) {
        const body = await tokenResponse.text();
        //console.log('TOKEN EXCHANGE FAILED:', tokenResponse.status, body);
        throw new Error('Token exchange failed');
      }

      //console.log('STEP: token exchange ok');
      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        scope?: string;
      };

      // Log granted scopes so we can confirm whether user-library-modify / user-library-read are included.
      console.log('[useSpotifyAuth] Granted scopes:', tokenData.scope ?? '(not returned)');

      const expiresAt = Date.now() + tokenData.expires_in * 1000;

      //console.log('STEP: backend register start', BACKEND_URL);
      const registerResponse = await fetch(`${BACKEND_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyAccessToken: tokenData.access_token }),
      });

      if (!registerResponse.ok) {
        const body = await registerResponse.text();
        //console.log('REGISTER FAILED:', registerResponse.status, body);
        throw new Error('Backend registration failed');
      }

      //console.log('STEP: register ok');
      const { supabaseToken, userId } = (await registerResponse.json()) as {
        supabaseToken: string;
        userId: string;
      };

      //console.log('STEP: setTokens');
      await setTokens({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        supabaseToken,
        userId,
      });
      //console.log('STEP: login complete');
    } catch (err) {
      //console.log('LOGIN ERROR:', err);
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
      stopAuth();
    }
  };

  return {
    login,
    isLoading,
    error,
  };
}
