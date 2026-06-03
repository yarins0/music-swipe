import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabase } from '../db/client';

const router = Router();

const VALID_STATUSES = new Set(['liked', 'super_liked', 'skipped', 'pending']);
const DECIDED_STATUSES = new Set(['liked', 'super_liked', 'skipped']);

interface ReconcileResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Resolve dangling 'pending' rows after a decision.
 *
 * A track deferred (status='pending') in one session and later decided (liked/super_liked/
 * skipped) in another session keeps its original session-scoped pending row, because POST
 * upserts by (sessionId, trackId). That stale row would wrongly resurface in a later
 * session's decide-later fetch. This deletes any pending row for the same (user, track)
 * that belongs to another session of the SAME source playlist — pending rows for other
 * playlists are left untouched.
 *
 * @param userId authenticated user id
 * @param swipes the batch being written
 * @param sessionPlaylistMap sessionId → source_playlist_id for the batch's sessions
 */
async function reconcilePendingDecisions(
  userId: string,
  swipes: SwipeInput[],
  sessionPlaylistMap: Map<string, string>,
): Promise<ReconcileResult> {
  // Group decided track ids by the playlist they were decided in.
  const decidedTracksByPlaylist = new Map<string, Set<string>>();
  for (const swipe of swipes) {
    if (!DECIDED_STATUSES.has(swipe.status as string)) continue;
    const playlistId = sessionPlaylistMap.get(swipe.sessionId as string);
    if (!playlistId) continue;
    const tracks = decidedTracksByPlaylist.get(playlistId) ?? new Set<string>();
    tracks.add(swipe.spotifyTrackId as string);
    decidedTracksByPlaylist.set(playlistId, tracks);
  }

  if (decidedTracksByPlaylist.size === 0) return { ok: true };

  const playlistIds = [...decidedTracksByPlaylist.keys()];
  const decidedTrackIds = [
    ...new Set([...decidedTracksByPlaylist.values()].flatMap((set) => [...set])),
  ];

  // All of this user's sessions for the affected playlists — used to scope the cleanup.
  const sessionsResult = await supabase
    .from('sessions')
    .select('id, source_playlist_id')
    .eq('user_id', userId)
    .in('source_playlist_id', playlistIds);

  if (sessionsResult.error) {
    console.error('POST /swipes reconciliation session lookup error:', sessionsResult.error);
    return { ok: false, status: 500, error: 'Failed to reconcile pending swipes' };
  }

  const sessionToPlaylist = new Map<string, string>(
    ((sessionsResult.data ?? []) as Array<{ id: string; source_playlist_id: string }>).map((s) => [
      s.id,
      s.source_playlist_id,
    ]),
  );
  if (sessionToPlaylist.size === 0) return { ok: true };

  // Find dangling pending rows for the decided tracks, then keep only those whose session
  // belongs to a playlist where that specific track was decided.
  const pendingResult = await supabase
    .from('swipes')
    .select('id, session_id, spotify_track_id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .in('spotify_track_id', decidedTrackIds);

  if (pendingResult.error) {
    console.error('POST /swipes reconciliation pending lookup error:', pendingResult.error);
    return { ok: false, status: 500, error: 'Failed to reconcile pending swipes' };
  }

  const danglingIds = ((pendingResult.data ?? []) as Array<{
    id: string;
    session_id: string;
    spotify_track_id: string;
  }>)
    .filter((row) => {
      const playlistId = sessionToPlaylist.get(row.session_id);
      return playlistId !== undefined && decidedTracksByPlaylist.get(playlistId)?.has(row.spotify_track_id);
    })
    .map((row) => row.id);

  if (danglingIds.length === 0) return { ok: true };

  const deleteResult = await supabase.from('swipes').delete().in('id', danglingIds);

  if (deleteResult.error) {
    console.error('POST /swipes reconciliation delete error:', deleteResult.error);
    return { ok: false, status: 500, error: 'Failed to reconcile pending swipes' };
  }

  return { ok: true };
}

interface SwipeInput {
  sessionId?: unknown;
  spotifyTrackId?: unknown;
  status?: unknown;
  destinationPlaylistIds?: unknown;
}

interface SwipeRow {
  id: string;
  session_id: string;
  spotify_track_id: string;
  status: string;
  swiped_at: string;
}

interface SwipeRowWithSession extends SwipeRow {
  sessions: { source_playlist_id: string };
}

// POST /swipes
// Batch upserts swipes for the authenticated user.
// Body: { swipes: SwipeInput[] }
// Returns: 200 { inserted: number, updated: number }
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { swipes } = req.body as { swipes?: unknown };

  if (!Array.isArray(swipes) || swipes.length === 0) {
    res.status(400).json({ error: 'swipes must be a non-empty array' });
    return;
  }

  // Validate each swipe entry
  for (let i = 0; i < swipes.length; i++) {
    const item = swipes[i] as SwipeInput;

    if (!item.sessionId || typeof item.sessionId !== 'string') {
      res.status(400).json({ error: `swipes[${i}].sessionId is required` });
      return;
    }

    if (!item.spotifyTrackId || typeof item.spotifyTrackId !== 'string') {
      res.status(400).json({ error: `swipes[${i}].spotifyTrackId is required` });
      return;
    }

    if (!item.status || typeof item.status !== 'string' || !VALID_STATUSES.has(item.status)) {
      res.status(400).json({
        error: `swipes[${i}].status must be one of: liked, super_liked, skipped, pending`,
      });
      return;
    }

    if (
      item.destinationPlaylistIds !== undefined &&
      !Array.isArray(item.destinationPlaylistIds)
    ) {
      res.status(400).json({ error: `swipes[${i}].destinationPlaylistIds must be an array` });
      return;
    }
  }

  // Collect unique session IDs referenced in the batch
  const sessionIds = [...new Set((swipes as SwipeInput[]).map((s) => s.sessionId as string))];

  // Verify that all referenced sessions belong to the authenticated user.
  // source_playlist_id is fetched alongside ownership so the post-write reconciliation
  // can scope dangling-pending cleanup to the right playlist (see below).
  const sessionOwnershipResult = await supabase
    .from('sessions')
    .select('id, user_id, source_playlist_id')
    .in('id', sessionIds);

  if (sessionOwnershipResult.error) {
    console.error('POST /swipes session ownership check error:', sessionOwnershipResult.error);
    res.status(500).json({ error: 'Failed to verify session ownership' });
    return;
  }

  const sessionRows = (sessionOwnershipResult.data ?? []) as Array<{
    id: string;
    user_id: string;
    source_playlist_id?: string;
  }>;
  const sessionMap = new Map<string, string>(sessionRows.map((s) => [s.id, s.user_id]));
  // sessionId → source_playlist_id, used by the reconciliation step after writes.
  const sessionPlaylistMap = new Map<string, string>(
    sessionRows
      .filter((s) => typeof s.source_playlist_id === 'string')
      .map((s) => [s.id, s.source_playlist_id as string]),
  );

  for (const sessionId of sessionIds) {
    const ownerId = sessionMap.get(sessionId);
    if (!ownerId || ownerId !== req.userId) {
      res.status(404).json({ error: `Session not found: ${sessionId}` });
      return;
    }
  }

  // Fetch all existing swipes across the batch sessions so we can match by composite key
  const existingSwipesResult = await supabase
    .from('swipes')
    .select('id, session_id, spotify_track_id')
    .in('session_id', sessionIds);

  if (existingSwipesResult.error) {
    console.error('POST /swipes existing swipe fetch error:', existingSwipesResult.error);
    res.status(500).json({ error: 'Failed to fetch existing swipes' });
    return;
  }

  // Build lookup: "sessionId|trackId" → existing swipe id
  const existingMap = new Map<string, string>(
    (
      (existingSwipesResult.data ?? []) as Array<{
        id: string;
        session_id: string;
        spotify_track_id: string;
      }>
    ).map((sw) => [`${sw.session_id}|${sw.spotify_track_id}`, sw.id]),
  );

  const toInsert: SwipeInput[] = [];
  const toUpdate: Array<{ id: string; swipe: SwipeInput }> = [];

  for (const swipe of swipes as SwipeInput[]) {
    const key = `${swipe.sessionId}|${swipe.spotifyTrackId}`;
    const existingId = existingMap.get(key);

    if (existingId) {
      toUpdate.push({ id: existingId, swipe });
    } else {
      toInsert.push(swipe);
    }
  }

  let inserted = 0;
  let updated = 0;

  // Insert new swipes
  if (toInsert.length > 0) {
    const insertRows = toInsert.map((s) => ({
      session_id: s.sessionId as string,
      user_id: req.userId,
      spotify_track_id: s.spotifyTrackId as string,
      status: s.status as string,
    }));

    const insertResult = await supabase
      .from('swipes')
      .insert(insertRows)
      .select('id, session_id, spotify_track_id');

    if (insertResult.error) {
      console.error('POST /swipes insert error:', insertResult.error);
      res.status(500).json({ error: 'Failed to insert swipes' });
      return;
    }

    const insertedRows = (insertResult.data ?? []) as Array<{ id: string }>;
    inserted = insertedRows.length;

    // Write swipe_destinations for newly inserted swipes
    for (let i = 0; i < toInsert.length; i++) {
      const swipeInput = toInsert[i];
      const insertedRow = insertedRows[i];
      const destIds = swipeInput.destinationPlaylistIds as string[] | undefined;

      if (!insertedRow || !destIds || destIds.length === 0) continue;

      const destRows = destIds.map((pid) => ({
        swipe_id: insertedRow.id,
        spotify_playlist_id: pid,
      }));

      const destInsertResult = await supabase.from('swipe_destinations').insert(destRows);

      if (destInsertResult.error) {
        console.error('POST /swipes swipe_destinations insert error:', destInsertResult.error);
        res.status(500).json({ error: 'Failed to insert swipe destinations' });
        return;
      }
    }
  }

  // Update existing swipes and refresh their destinations
  for (const { id, swipe } of toUpdate) {
    const updateResult = await supabase
      .from('swipes')
      .update({ status: swipe.status as string })
      .eq('id', id);

    if (updateResult.error) {
      console.error('POST /swipes update error:', updateResult.error);
      res.status(500).json({ error: 'Failed to update swipe' });
      return;
    }

    updated++;

    const destIds = swipe.destinationPlaylistIds as string[] | undefined;

    // Delete existing destinations for this swipe, then re-insert
    const deleteResult = await supabase
      .from('swipe_destinations')
      .delete()
      .eq('swipe_id', id);

    if (deleteResult.error) {
      console.error('POST /swipes destination delete error:', deleteResult.error);
      res.status(500).json({ error: 'Failed to refresh swipe destinations' });
      return;
    }

    if (destIds && destIds.length > 0) {
      const destRows = destIds.map((pid) => ({
        swipe_id: id,
        spotify_playlist_id: pid,
      }));

      const destInsertResult = await supabase.from('swipe_destinations').insert(destRows);

      if (destInsertResult.error) {
        console.error('POST /swipes destination re-insert error:', destInsertResult.error);
        res.status(500).json({ error: 'Failed to update swipe destinations' });
        return;
      }
    }
  }

  // Clean up any pending rows now superseded by a decision in this batch.
  const reconcile = await reconcilePendingDecisions(
    req.userId as string,
    swipes as SwipeInput[],
    sessionPlaylistMap,
  );
  if (!reconcile.ok) {
    res.status(reconcile.status ?? 500).json({ error: reconcile.error });
    return;
  }

  res.json({ inserted, updated });
});

// GET /swipes
// Returns swipes for the authenticated user, optionally filtered.
// Query params: status (one of the valid statuses), source_playlist_id (string), session_id (string)
// Returns: 200 { swipes: SwipeRecord[] }
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { status, source_playlist_id, session_id } = req.query;

  if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.has(status))) {
    res.status(400).json({
      error: 'status must be one of: liked, super_liked, skipped, pending',
    });
    return;
  }

  if (source_playlist_id !== undefined && typeof source_playlist_id !== 'string') {
    res.status(400).json({ error: 'source_playlist_id must be a string' });
    return;
  }

  if (session_id !== undefined && typeof session_id !== 'string') {
    res.status(400).json({ error: 'session_id must be a string' });
    return;
  }

  // When session_id is provided, verify the session belongs to the authenticated user
  if (session_id) {
    const { data: sessionCheck, error: sessionCheckError } = await supabase
      .from('sessions')
      .select('id, user_id')
      .eq('id', session_id)
      .maybeSingle();

    if (sessionCheckError) {
      console.error('GET /swipes session ownership check error:', sessionCheckError);
      res.status(500).json({ error: 'Failed to verify session ownership' });
      return;
    }

    if (!sessionCheck || sessionCheck.user_id !== req.userId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
  }

  // Build filter params for the swipes query
  const filters: Record<string, string> = { user_id: req.userId as string };

  if (status) {
    filters['status'] = status;
  }

  if (source_playlist_id) {
    filters['sessions.source_playlist_id'] = source_playlist_id;
  }

  // Fetch swipes joined with session data for the authenticated user
  let swipesQuery = supabase
    .from('swipes')
    .select(
      'id, session_id, spotify_track_id, status, swiped_at, sessions!inner(source_playlist_id)',
    )
    .match(filters);

  if (session_id) {
    swipesQuery = swipesQuery.eq('session_id', session_id);
  }

  const swipesResult = await swipesQuery;

  if (swipesResult.error) {
    console.error('GET /swipes fetch error:', swipesResult.error);
    res.status(500).json({ error: 'Failed to fetch swipes' });
    return;
  }

  const rows = (swipesResult.data ?? []) as unknown as SwipeRowWithSession[];

  // Dedupe safety net for the decide-later fetch: a pending row can dangle across sessions
  // (see reconcilePendingDecisions). When listing pending tracks for a playlist, exclude any
  // track that already has a decision in that playlist and collapse duplicate pending rows
  // to one per track, so a decided or repeated track never resurfaces.
  let resultRows = rows;
  if (status === 'pending' && source_playlist_id) {
    const decidedResult = await supabase
      .from('swipes')
      .select('spotify_track_id, sessions!inner(source_playlist_id)')
      .match({ user_id: req.userId as string, 'sessions.source_playlist_id': source_playlist_id })
      .in('status', [...DECIDED_STATUSES]);

    if (decidedResult.error) {
      console.error('GET /swipes decided-tracks fetch error:', decidedResult.error);
      res.status(500).json({ error: 'Failed to fetch swipes' });
      return;
    }

    const decidedTrackIds = new Set(
      ((decidedResult.data ?? []) as Array<{ spotify_track_id: string }>).map(
        (r) => r.spotify_track_id,
      ),
    );

    const seenTrackIds = new Set<string>();
    resultRows = rows.filter((row) => {
      if (decidedTrackIds.has(row.spotify_track_id)) return false;
      if (seenTrackIds.has(row.spotify_track_id)) return false;
      seenTrackIds.add(row.spotify_track_id);
      return true;
    });
  }

  const swipeIds = resultRows.map((s) => s.id);

  // Fetch all destination playlist IDs for these swipes in one query
  const destinationsBySwipe = new Map<string, string[]>();

  if (swipeIds.length > 0) {
    const destResult = await supabase
      .from('swipe_destinations')
      .select('swipe_id, spotify_playlist_id')
      .in('swipe_id', swipeIds);

    if (destResult.error) {
      console.error('GET /swipes destinations fetch error:', destResult.error);
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

  const result = resultRows.map((s) => ({
    id: s.id,
    sessionId: s.session_id,
    spotifyTrackId: s.spotify_track_id,
    status: s.status,
    swipedAt: s.swiped_at,
    sourcePlaylistId: s.sessions?.source_playlist_id ?? null,
    destinationPlaylistIds: destinationsBySwipe.get(s.id) ?? [],
  }));

  res.json({ swipes: result });
});

export default router;
