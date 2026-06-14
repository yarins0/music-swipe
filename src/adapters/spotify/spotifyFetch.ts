import { PlatformError, PlatformErrorCode } from '../interface';

export interface SpotifyAuthContext {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  onTokenRefreshed: (newToken: string, newExpiresAt: number, newRefreshToken?: string) => Promise<void>;
  onAuthExpired: () => Promise<void>;
}

const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const PROACTIVE_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function performTokenRefresh(auth: SpotifyAuthContext): Promise<string> {
  const clientId = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: clientId,
  });

  let response: Response;
  try {
    response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    // Network failure reaching the token endpoint is transient, not an auth problem.
    // Preserve auth (do NOT call onAuthExpired) so a retry can succeed once connectivity returns.
    throw new PlatformError(PlatformErrorCode.NETWORK_ERROR, 'Network error reaching Spotify token endpoint');
  }

  if (!response.ok) {
    // Only a revoked/expired refresh token (400/401 invalid_grant) is a true auth-expiry.
    // Any other non-OK status (5xx, etc.) is a transient outage — surface a retryable error
    // WITHOUT discarding the refresh token, otherwise a brief blip becomes a permanent logout.
    if (response.status === 400 || response.status === 401) {
      await auth.onAuthExpired();
      throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED, 'Refresh token expired or revoked');
    }
    throw new PlatformError(
      PlatformErrorCode.NETWORK_ERROR,
      `Spotify token endpoint returned ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string; // Spotify rotates refresh tokens on PKCE flows
  };

  const newExpiresAt = Date.now() + data.expires_in * 1000;
  await auth.onTokenRefreshed(data.access_token, newExpiresAt, data.refresh_token);
  return data.access_token;
}

// Single-flight guard: concurrent callers (the session-start burst of parallel spotifyFetch
// calls — playlists + liked-count + devices) share one refresh. Without this, each would POST
// the same PKCE refresh token; Spotify rotates the token on use, so all but the first send a
// now-revoked token, fail, and force a logout mid-session.
let inFlightRefresh: Promise<string> | null = null;

function refreshSpotifyToken(auth: SpotifyAuthContext): Promise<string> {
  if (inFlightRefresh) return inFlightRefresh;
  // Cleared in finally (success or failure) so a failed refresh never poisons later attempts.
  inFlightRefresh = performTokenRefresh(auth).finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

function mapHttpError(status: number, body: string): never {
  if (status === 401) throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED, body || undefined);
  if (status === 403) throw new PlatformError(PlatformErrorCode.PERMISSION_DENIED, `Spotify 403: ${body}`);
  if (status === 404) throw new PlatformError(PlatformErrorCode.NOT_FOUND, body || undefined);
  if (status === 429) throw new PlatformError(PlatformErrorCode.RATE_LIMITED, body || undefined);
  throw new PlatformError(PlatformErrorCode.UNKNOWN, `Spotify API error ${status}: ${body}`);
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
        // Default Content-Type first so caller headers can override it (e.g. a caller
        // sending form-encoded or no body): later keys win in object-spread order.
        'Content-Type': 'application/json',
        ...options.headers,
        // Authorization last: the token spotifyFetch manages (refresh/rotation) is
        // authoritative and must not be overridable by caller-supplied headers.
        Authorization: `Bearer ${token}`,
      },
    });

  for (let attempt = 0; attempt < MAX_RATE_LIMIT_RETRIES; attempt++) {
    let response = await makeRequest(currentToken);

    // Reactive fallback: if the call returns 401, refresh once and retry
    if (response.status === 401) {
      try {
        currentToken = await refreshSpotifyToken(auth);
      } catch (error) {
        // Preserve the real cause: a transient NETWORK_ERROR must not masquerade as AUTH_EXPIRED.
        // If the refresh genuinely expired auth, it already called onAuthExpired before throwing.
        if (error instanceof PlatformError) throw error;
        throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
      }

      response = await makeRequest(currentToken);

      if (response.status === 401) {
        await auth.onAuthExpired();
        throw new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
      }
    }

    // Rate limit: respect Retry-After, then retry. On the last attempt fall through to mapHttpError.
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES - 1) {
      const retryAfter = response.headers.get('retry-after');
      const parsed = retryAfter ? parseInt(retryAfter, 10) : 5;
      // Floor at 1s (some APIs send 0 meaning "immediately", which lands in the same window).
      // Cap at 120s so a single call can survive realistic Spotify rate-limit windows.
      const waitSeconds = Math.max(1, Math.min(Number.isNaN(parsed) ? 5 : parsed, 120));
      console.warn(`Spotify rate limit hit — waiting ${waitSeconds}s (retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`);
      await sleep(waitSeconds * 1000);
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      mapHttpError(response.status, body);
    }

    // 204 No Content or 200 with no body (e.g. PUT /me/tracks) — return empty object
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text().catch(() => '');
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  throw new PlatformError(PlatformErrorCode.RATE_LIMITED, 'Spotify rate limit: max retries exceeded');
}
