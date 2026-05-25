import type { Request, Response, NextFunction } from 'express';
import { supabase, supabaseAuth } from '../db/client';

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();

  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  const { data: { user }, error } = await supabaseAuth.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Resolve the custom users.id (FK target for sessions/swipes) from the Supabase auth ID.
  // supabase.auth.getUser returns the auth user whose id lives in users.supabase_id,
  // not in users.id — these are different UUIDs.
  const { data: appUser, error: userLookupError } = await supabase
    .from('users')
    .select('id')
    .eq('supabase_id', user.id)
    .maybeSingle();

  if (userLookupError) {
    console.error('requireAuth user lookup error:', userLookupError);
    res.status(500).json({ error: 'Failed to resolve user' });
    return;
  }

  if (!appUser) {
    res.status(401).json({ error: 'User not registered' });
    return;
  }

  req.userId = appUser.id;
  next();
}
