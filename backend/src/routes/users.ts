import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabase } from '../db/client';

const router = Router();

// GET /users/me
// Returns the authenticated user's profile.
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, spotify_user_id, display_name, email, created_at')
    .eq('supabase_id', req.userId)
    .maybeSingle();

  if (error) {
    console.error('GET /users/me error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
    return;
  }

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    spotifyUserId: user.spotify_user_id,
    displayName: user.display_name,
    email: user.email,
    createdAt: user.created_at,
  });
});

export default router;
