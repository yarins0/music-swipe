import { Router } from 'express';
import type { Request, Response } from 'express';
import { hkdfSync } from 'crypto';
import rateLimit from 'express-rate-limit';
import { supabase, supabaseAuth } from '../db/client';

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later' },
});

const router = Router();

interface SpotifyUser {
  id: string;
  display_name: string | null;
  email: string | null;
}

async function getSpotifyUser(accessToken: string): Promise<SpotifyUser> {
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401) {
    throw new Error('INVALID_SPOTIFY_TOKEN');
  }

  if (!response.ok) {
    throw new Error(`Spotify /me failed: ${response.status}`);
  }

  return response.json() as Promise<SpotifyUser>;
}

// Derives a stable, server-side password for a given Spotify user ID using HKDF-SHA256.
// Never stored or transmitted — only used to create/retrieve a Supabase session.
// HKDF provides proper key derivation with domain separation via info parameter.
// Changing SUPABASE_SERVICE_ROLE_KEY will invalidate all derived passwords (existing
// users would need to re-register); treat key rotation as a breaking migration.
function deriveUserPassword(spotifyUserId: string): string {
  const ikm = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const salt = Buffer.from('music-swipe-auth-salt-v1');
  const info = Buffer.from(`music-swipe:${spotifyUserId}`);
  const derived = hkdfSync('sha256', ikm, salt, info, 32);
  return Buffer.from(derived).toString('hex');
}

// POST /auth/register
// Called by mobile after completing Spotify PKCE. Receives the Spotify access
// token, verifies it with Spotify, creates or updates a user record, and
// returns a Supabase JWT the client can use for all subsequent API calls.
// The Spotify token is never stored.
router.post('/register', registerLimiter, async (req: Request, res: Response): Promise<void> => {
  const { spotifyAccessToken } = req.body as { spotifyAccessToken?: string };

  if (!spotifyAccessToken) {
    res.status(400).json({ error: 'spotifyAccessToken is required' });
    return;
  }

  let spotifyUser: SpotifyUser;
  try {
    spotifyUser = await getSpotifyUser(spotifyAccessToken);
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_SPOTIFY_TOKEN') {
      res.status(401).json({ error: 'Invalid Spotify access token' });
      return;
    }
    console.error('Spotify /me error:', err);
    res.status(502).json({ error: 'Failed to verify Spotify token' });
    return;
  }

  try {
    const deterministicEmail = `${spotifyUser.id}@music-swipe.internal`;
    const password = deriveUserPassword(spotifyUser.id);

    // Create Supabase auth user — safe to ignore "already registered" since we upsert below.
    // Uses supabaseAuth (auth-only client) to avoid polluting supabase's REST headers.
    const { error: createError } = await supabaseAuth.auth.admin.createUser({
      email: deterministicEmail,
      password,
      email_confirm: true,
    });

    if (createError && !createError.message?.includes('already been registered')) {
      console.error('Supabase createUser error:', createError);
      res.status(500).json({ error: 'Failed to create user' });
      return;
    }

    // Sign in to get the session and the canonical Supabase user UUID.
    // Uses supabaseAuth so signInWithPassword does not update the DB client's auth state.
    const { data: sessionData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
      email: deterministicEmail,
      password,
    });

    if (signInError || !sessionData.session) {
      console.error('Supabase signIn error:', signInError);
      res.status(500).json({ error: 'Failed to create session' });
      return;
    }

    // Upsert public.users — idempotent, handles first-time and returning users,
    // and recovers from any prior failed inserts.
    const { error: upsertError } = await supabase
      .from('users')
      .upsert(
        {
          supabase_id: sessionData.session.user.id,
          spotify_user_id: spotifyUser.id,
          display_name: spotifyUser.display_name,
          email: spotifyUser.email,
        },
        { onConflict: 'supabase_id' },
      );

    if (upsertError) {
      console.error('Supabase upsert users error:', upsertError);
      res.status(500).json({ error: 'Failed to create user record' });
      return;
    }

    res.json({
      supabaseToken: sessionData.session.access_token,
      userId: sessionData.session.user.id,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
