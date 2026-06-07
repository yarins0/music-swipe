import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabase } from '../db/client';
import { TRACK_SELECT, buildTracksById, type TrackRow, type TrackResponse } from './trackResponse';

const router = Router();

const VALID_SESSION_STATUSES = new Set(['active', 'completed']);
const SESSION_LIST_LIMIT = 50;

interface CreateSessionBody {
  sourcePlaylistId?: unknown;
  sourcePlaylistName?: unknown;
  destinationPlaylistIds?: unknown;
  destinationPlaylistNames?: unknown;
  isFilterMode?: unknown;
  totalTracks?: unknown;
}

interface UpdateSessionBody {
  endedAt?: unknown;
  resumeOffset?: unknown;
  status?: unknown;
  sourcePlaylistName?: unknown;
  destinationPlaylistIds?: unknown;
  destinationPlaylistNames?: unknown;
  totalTracks?: unknown;
  isFilterMode?: unknown;
}

/** Validate an optional string[] body field; returns an error message or null. */
function validateOptionalStringArray(value: unknown, fieldName: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return `${fieldName} must be an array of strings`;
  }
  return null;
}

// POST /sessions
// Creates a new swipe session for the authenticated user.
// Body: { sourcePlaylistId: string }
// Returns: 201 { id: uuid }
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const {
    sourcePlaylistId,
    sourcePlaylistName,
    destinationPlaylistIds,
    destinationPlaylistNames,
    isFilterMode,
    totalTracks,
  } = req.body as CreateSessionBody;

  if (!sourcePlaylistId || typeof sourcePlaylistId !== 'string') {
    res.status(400).json({ error: 'sourcePlaylistId is required' });
    return;
  }

  if (sourcePlaylistName !== undefined && typeof sourcePlaylistName !== 'string') {
    res.status(400).json({ error: 'sourcePlaylistName must be a string' });
    return;
  }

  const destIdsError = validateOptionalStringArray(destinationPlaylistIds, 'destinationPlaylistIds');
  if (destIdsError) {
    res.status(400).json({ error: destIdsError });
    return;
  }

  const destNamesError = validateOptionalStringArray(
    destinationPlaylistNames,
    'destinationPlaylistNames',
  );
  if (destNamesError) {
    res.status(400).json({ error: destNamesError });
    return;
  }

  if (isFilterMode !== undefined && typeof isFilterMode !== 'boolean') {
    res.status(400).json({ error: 'isFilterMode must be a boolean' });
    return;
  }

  if (totalTracks !== undefined && typeof totalTracks !== 'number') {
    res.status(400).json({ error: 'totalTracks must be a number' });
    return;
  }

  // Only include optional columns when provided so the DB defaults (and the
  // existing minimal-insert contract) hold for callers that omit them.
  const insertPayload: Record<string, unknown> = {
    user_id: req.userId,
    source_playlist_id: sourcePlaylistId,
  };
  if (sourcePlaylistName !== undefined) insertPayload['source_playlist_name'] = sourcePlaylistName;
  if (destinationPlaylistIds !== undefined) {
    insertPayload['destination_playlist_ids'] = destinationPlaylistIds;
  }
  if (destinationPlaylistNames !== undefined) {
    insertPayload['destination_playlist_names'] = destinationPlaylistNames;
  }
  if (isFilterMode !== undefined) insertPayload['is_filter_mode'] = isFilterMode;
  if (totalTracks !== undefined) insertPayload['total_tracks'] = totalTracks;

  const { data, error } = await supabase
    .from('sessions')
    .insert(insertPayload)
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
  const {
    endedAt,
    resumeOffset,
    status,
    sourcePlaylistName,
    destinationPlaylistIds,
    destinationPlaylistNames,
    totalTracks,
    isFilterMode,
  } = req.body as UpdateSessionBody;

  if (status !== undefined && (typeof status !== 'string' || !VALID_SESSION_STATUSES.has(status))) {
    res.status(400).json({ error: 'status must be one of: active, completed' });
    return;
  }

  if (resumeOffset !== undefined && typeof resumeOffset !== 'number') {
    res.status(400).json({ error: 'resumeOffset must be a number' });
    return;
  }

  if (totalTracks !== undefined && typeof totalTracks !== 'number') {
    res.status(400).json({ error: 'totalTracks must be a number' });
    return;
  }

  if (sourcePlaylistName !== undefined && typeof sourcePlaylistName !== 'string') {
    res.status(400).json({ error: 'sourcePlaylistName must be a string' });
    return;
  }

  if (isFilterMode !== undefined && typeof isFilterMode !== 'boolean') {
    res.status(400).json({ error: 'isFilterMode must be a boolean' });
    return;
  }

  const destIdsError = validateOptionalStringArray(destinationPlaylistIds, 'destinationPlaylistIds');
  if (destIdsError) {
    res.status(400).json({ error: destIdsError });
    return;
  }

  const destNamesError = validateOptionalStringArray(
    destinationPlaylistNames,
    'destinationPlaylistNames',
  );
  if (destNamesError) {
    res.status(400).json({ error: destNamesError });
    return;
  }

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

  if (endedAt !== undefined) updatePayload['ended_at'] = endedAt;
  if (resumeOffset !== undefined) updatePayload['resume_offset'] = resumeOffset;
  if (status !== undefined) updatePayload['status'] = status;
  if (sourcePlaylistName !== undefined) updatePayload['source_playlist_name'] = sourcePlaylistName;
  if (destinationPlaylistIds !== undefined) {
    updatePayload['destination_playlist_ids'] = destinationPlaylistIds;
  }
  if (destinationPlaylistNames !== undefined) {
    updatePayload['destination_playlist_names'] = destinationPlaylistNames;
  }
  if (totalTracks !== undefined) updatePayload['total_tracks'] = totalTracks;
  if (isFilterMode !== undefined) updatePayload['is_filter_mode'] = isFilterMode;

  // Reject a no-op PATCH before stamping updated_at, so an empty body is still
  // a 400 rather than a bare timestamp bump.
  if (Object.keys(updatePayload).length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  // Any real change bumps updated_at so History sorts by recency on restore.
  updatePayload['updated_at'] = new Date().toISOString();

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

interface SessionListRow {
  id: string;
  source_playlist_id: string;
  source_playlist_name: string | null;
  destination_playlist_ids: string[] | null;
  destination_playlist_names: string[] | null;
  is_filter_mode: boolean;
  resume_offset: number;
  total_tracks: number;
  status: string;
  started_at: string;
  updated_at: string;
}

interface SwipeListRow {
  id: string;
  session_id: string;
  spotify_track_id: string;
  status: string;
  swiped_at: string;
  liked_songs_written_by_us: boolean;
}

interface SessionCounts {
  swipedCount: number;
  likedCount: number;
  superLikedCount: number;
}

const SESSION_LIST_SELECT =
  'id, source_playlist_id, source_playlist_name, destination_playlist_ids, ' +
  'destination_playlist_names, is_filter_mode, resume_offset, total_tracks, status, ' +
  'started_at, updated_at';

// GET /sessions
// Returns the authenticated user's sessions (most-recent-first, capped at
// SESSION_LIST_LIMIT) with hydrated liked-track lists, so the client History
// tab can restore across devices/reinstalls. Counts are computed live from the
// swipes table (pending excluded), matching GET /sessions/:id. Fully batched —
// no per-session queries.
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionsResult = await supabase
    .from('sessions')
    .select(SESSION_LIST_SELECT)
    .eq('user_id', req.userId)
    .order('updated_at', { ascending: false })
    .limit(SESSION_LIST_LIMIT);

  if (sessionsResult.error) {
    console.error('GET /sessions fetch error:', sessionsResult.error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
    return;
  }

  const sessionRows = (sessionsResult.data ?? []) as unknown as SessionListRow[];
  if (sessionRows.length === 0) {
    res.json({ sessions: [] });
    return;
  }

  const sessionIds = sessionRows.map((s) => s.id);

  // One swipes query serves both the live counts (all decided rows) and the
  // restore list (the liked/super_liked subset).
  const swipesResult = await supabase
    .from('swipes')
    .select('id, session_id, spotify_track_id, status, swiped_at, liked_songs_written_by_us')
    .in('session_id', sessionIds);

  if (swipesResult.error) {
    console.error('GET /sessions swipes fetch error:', swipesResult.error);
    res.status(500).json({ error: 'Failed to fetch session swipes' });
    return;
  }

  const swipeRows = (swipesResult.data ?? []) as SwipeListRow[];
  const likedRows = swipeRows.filter(
    (r) => r.status === 'liked' || r.status === 'super_liked',
  );
  const likedSwipeIds = likedRows.map((r) => r.id);
  const likedTrackIds = [...new Set(likedRows.map((r) => r.spotify_track_id))];

  // Destinations for the liked swipes (one batched query).
  const destinationsBySwipe = new Map<string, string[]>();
  if (likedSwipeIds.length > 0) {
    const destResult = await supabase
      .from('swipe_destinations')
      .select('swipe_id, spotify_playlist_id')
      .in('swipe_id', likedSwipeIds);

    if (destResult.error) {
      console.error('GET /sessions destinations fetch error:', destResult.error);
      res.status(500).json({ error: 'Failed to fetch swipe destinations' });
      return;
    }

    for (const dest of (destResult.data ?? []) as Array<{
      swipe_id: string;
      spotify_playlist_id: string;
    }>) {
      const existing = destinationsBySwipe.get(dest.swipe_id) ?? [];
      existing.push(dest.spotify_playlist_id);
      destinationsBySwipe.set(dest.swipe_id, existing);
    }
  }

  // Track metadata for the liked swipes (one batched query).
  let tracksById = new Map<string, TrackResponse>();
  if (likedTrackIds.length > 0) {
    const tracksResult = await supabase
      .from('tracks')
      .select(TRACK_SELECT)
      .in('spotify_track_id', likedTrackIds);

    if (tracksResult.error) {
      console.error('GET /sessions tracks fetch error:', tracksResult.error);
      res.status(500).json({ error: 'Failed to fetch tracks' });
      return;
    }

    tracksById = buildTracksById((tracksResult.data ?? []) as TrackRow[]);
  }

  // Live counts per session (decided statuses only; pending excluded).
  const countsBySession = new Map<string, SessionCounts>();
  for (const id of sessionIds) {
    countsBySession.set(id, { swipedCount: 0, likedCount: 0, superLikedCount: 0 });
  }
  for (const swipe of swipeRows) {
    const counts = countsBySession.get(swipe.session_id);
    if (!counts) continue;
    if (swipe.status === 'liked') {
      counts.swipedCount++;
      counts.likedCount++;
    } else if (swipe.status === 'super_liked') {
      counts.swipedCount++;
      counts.superLikedCount++;
    } else if (swipe.status === 'skipped') {
      counts.swipedCount++;
    }
  }

  // Liked swipes per session, ordered oldest-first (matches local insertion order).
  const likedBySession = new Map<string, unknown[]>();
  const sortedLikedRows = [...likedRows].sort((a, b) => a.swiped_at.localeCompare(b.swiped_at));
  for (const row of sortedLikedRows) {
    const list = likedBySession.get(row.session_id) ?? [];
    list.push({
      id: row.id,
      spotifyTrackId: row.spotify_track_id,
      status: row.status,
      swipedAt: row.swiped_at,
      destinationPlaylistIds: destinationsBySwipe.get(row.id) ?? [],
      track: tracksById.get(row.spotify_track_id) ?? null,
      likedSongsWrittenByUs: row.liked_songs_written_by_us === true,
    });
    likedBySession.set(row.session_id, list);
  }

  const sessions = sessionRows.map((row) => {
    const counts = countsBySession.get(row.id) as SessionCounts;
    return {
      sessionId: row.id,
      sourcePlaylistId: row.source_playlist_id,
      sourcePlaylistName: row.source_playlist_name,
      destinationPlaylistIds: row.destination_playlist_ids ?? [],
      destinationPlaylistNames: row.destination_playlist_names ?? [],
      isFilterMode: row.is_filter_mode,
      resumeOffset: row.resume_offset,
      totalTracks: row.total_tracks,
      status: row.status,
      createdAt: row.started_at,
      updatedAt: row.updated_at,
      swipedCount: counts.swipedCount,
      likedCount: counts.likedCount,
      superLikedCount: counts.superLikedCount,
      likedSwipes: likedBySession.get(row.id) ?? [],
    };
  });

  res.json({ sessions });
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
