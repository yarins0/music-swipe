import { PlatformError, PlatformErrorCode } from '../interface';

export interface SpotifyAuthContext {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  onTokenRefreshed: (newToken: string, newExpiresAt: number) => Promise<void>;
  onAuthExpired: () => Promise<void>;
}

const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const PROACTIVE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function refreshSpotifyToken(auth: SpotifyAuthContext): Promise<string> {
  const clientId = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: clientId,
  });

  const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    await auth.onAuthExpired();
    throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED, 'Refresh token expired or revoked');
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const newExpiresAt = Date.now() + data.expires_in * 1000;
  await auth.onTokenRefreshed(data.access_token, newExpiresAt);
  return data.access_token;
}

function mapHttpError(status: number): never {
  if (status === 401) throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
  if (status === 403) throw new PlatformError(PlatformErrorCode.PERMISSION_DENIED);
  if (status === 404) throw new PlatformError(PlatformErrorCode.NOT_FOUND);
  if (status === 429) throw new PlatformError(PlatformErrorCode.RATE_LIMITED);
  throw new PlatformError(PlatformErrorCode.UNKNOWN, `Spotify API error: ${status}`);
}

export async function spotifyFetch<T = unknown>(
  endpoint: string,
  options: RequestInit,
  auth: SpotifyAuthContext,
): Promise<T> {
  let currentToken = auth.accessToken;

  // Proactive refresh: refresh before the call if within the 5-min buffer window
  if (Date.now() >= auth.expiresAt - PROACTIVE_REFRESH_BUFFER_MS) {
    currentToken = await refreshSpotifyToken(auth);
  }

  const makeRequest = (token: string) =>
    fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

  let response = await makeRequest(currentToken);

  // Reactive fallback: if the call returns 401, refresh once and retry
  if (response.status === 401) {
    let retryToken: string;
    try {
      retryToken = await refreshSpotifyToken(auth);
    } catch {
      // refreshSpotifyToken already called onAuthExpired
      throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
    }

    response = await makeRequest(retryToken);

    if (response.status === 401) {
      await auth.onAuthExpired();
      throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
    }
  }

  if (!response.ok) {
    mapHttpError(response.status);
  }

  // 204 No Content — return empty object
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
