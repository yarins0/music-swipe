import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabase } from '../db/client';

const router = Router();

interface CreateSessionBody {
  sourcePlaylistId?: unknown;
}

interface UpdateSessionBody {
  endedAt?: unknown;
}

// POST /sessions
// Creates a new swipe session for the authenticated user.
// Body: { sourcePlaylistId: string }
// Returns: 201 { id: uuid }
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { sourcePlaylistId } = req.body as CreateSessionBody;

  if (!sourcePlaylistId || typeof sourcePlaylistId !== 'string') {
    res.status(400).json({ error: 'sourcePlaylistId is required' });
    return;
  }

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: req.userId,
      source_playlist_id: sourcePlaylistId,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('POST /sessions insert error:', error);
    res.status(500).json({ error: 'Failed to create session' });
    return;
  }

  res.status(201).json({ id: data.id });
});

// PATCH /sessions/:id
// Updates an existing session owned by the authenticated user.
// Body: { endedAt?: string }
// Returns: 200 { ok: true }
// Returns 404 if the session does not exist or belongs to a different user.
router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { endedAt } = req.body as UpdateSessionBody;

  // Fetch the session to verify ownership
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    console.error('PATCH /sessions/:id fetch error:', fetchError);
    res.status(500).json({ error: 'Failed to fetch session' });
    return;
  }

  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Build the update payload from whichever fields were provided
  const updatePayload: Record<string, unknown> = {};

  if (endedAt !== undefined) {
    updatePayload['ended_at'] = endedAt;
  }

  if (Object.keys(updatePayload).length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  const { error: updateError } = await supabase
    .from('sessions')
    .update(updatePayload)
    .eq('id', id);

  if (updateError) {
    console.error('PATCH /sessions/:id update error:', updateError);
    res.status(500).json({ error: 'Failed to update session' });
    return;
  }

  res.json({ ok: true });
});

// GET /sessions/:id
// Returns a session owned by the authenticated user including swipe stats.
// Counts are computed live from the swipes table so they are always accurate.
// Returns 404 if the session does not exist or belongs to a different user.
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, user_id, source_playlist_id, started_at, ended_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('GET /sessions/:id fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
    return;
  }

  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Compute counts from the swipes table. Only decided statuses (liked, super_liked,
  // skipped) contribute to swipedCount; pending swipes are excluded because the user
  // has not yet made a final decision on them.
  const { data: swipes, error: swipesError } = await supabase
    .from('swipes')
    .select('status')
    .eq('session_id', id);

  if (swipesError) {
    console.error('GET /sessions/:id swipes fetch error:', swipesError);
    res.status(500).json({ error: 'Failed to fetch session swipes' });
    return;
  }

  let swipedCount = 0;
  let likedCount = 0;
  let superLikedCount = 0;
  for (const swipe of swipes ?? []) {
    if (swipe.status === 'liked') {
      swipedCount++;
      likedCount++;
    } else if (swipe.status === 'super_liked') {
      swipedCount++;
      superLikedCount++;
    } else if (swipe.status === 'skipped') {
      swipedCount++;
    }
    // 'pending' is intentionally excluded from all counts
  }

  res.json({
    id: session.id,
    sourcePlaylistId: session.source_playlist_id,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    swipedCount,
    likedCount,
    superLikedCount,
  });
});

export default router;
