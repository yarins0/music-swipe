-- Migration 0004: Fold dangling-pending reconciliation into upsert_swipes (M4).
--
-- Goal: make the swipe upsert and the dangling-'pending' cleanup atomic.
--
-- Before this migration the POST /swipes route did two separate round-trips:
-- the upsert_swipes RPC committed first, then the route ran a second batch
-- DELETE to reconcile stale pending rows. A crash or network failure between
-- the two left orphaned 'pending' rows (later masked, but not removed, by the
-- GET ?status=pending dedupe filter), and the delete's own 500 path could make
-- the client retry the whole POST and double-count inserts/updates.
--
-- Fix: move the reconciliation DELETE into upsert_swipes so the upsert and the
-- cleanup share one transaction — either both land or neither does. The route's
-- separate reconciliation pass is removed in the same change.
--
-- What "reconciliation" means: a track deferred (status='pending') in one
-- session and later decided (liked/super_liked/skipped) in another session of
-- the SAME source playlist keeps its original session-scoped pending row,
-- because swipes are keyed by (session_id, spotify_track_id). That stale row
-- would wrongly resurface in a later decide-later fetch. We delete every pending
-- row for this user whose (source_playlist_id, track) was decided in THIS batch.
-- Pending rows for other playlists are left untouched.
--
-- IMPORTANT — run in order on your Supabase project (SQL editor):
--   Step 1: CREATE OR REPLACE upsert_swipes (labelled "STEP 1")
--
-- After applying, reload the PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';
--
-- Same signature (p_user_id UUID, p_swipes JSONB) and same { inserted, updated }
-- contract — CREATE OR REPLACE is idempotent and safe to re-run. The nested
-- "track" metadata (0002) and sticky "likedSongsWrittenByUs" flag (0003) are
-- carried over unchanged.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- STEP 1 — Create (or replace) upsert_swipes with in-transaction reconciliation.
-- ===========================================================================
CREATE OR REPLACE FUNCTION upsert_swipes(
  p_user_id UUID,
  p_swipes  JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted    INT := 0;
  v_updated     INT := 0;
  v_item        JSONB;
  v_track       JSONB;
  v_swipe_id    UUID;
  v_session_id  UUID;
  v_track_id    TEXT;
  v_status      TEXT;
  v_dest_ids    TEXT[];
  v_dest_id     TEXT;
  v_artists     TEXT[];
  v_lib_written BOOLEAN;
  v_xmax        BIGINT;
BEGIN
  FOR v_item IN SELECT jsonb_array_elements(p_swipes)
  LOOP
    v_session_id := (v_item->>'sessionId')::UUID;
    v_track_id   := v_item->>'spotifyTrackId';
    v_status     := v_item->>'status';
    v_lib_written := COALESCE((v_item->>'likedSongsWrittenByUs')::BOOLEAN, false);

    -- Build destination array; treat missing/null as empty.
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(v_item->'destinationPlaylistIds')
    )
    INTO v_dest_ids;

    IF v_dest_ids IS NULL THEN
      v_dest_ids := '{}';
    END IF;

    -- Optional track metadata upsert (unchanged from migration 0002). Guarded so
    -- legacy payloads (no "track") and malformed ones (null title) are skipped.
    v_track := v_item->'track';
    IF v_track IS NOT NULL AND (v_track->>'title') IS NOT NULL THEN
      SELECT ARRAY(
        SELECT jsonb_array_elements_text(v_track->'artists')
      )
      INTO v_artists;

      IF v_artists IS NULL THEN
        v_artists := '{}';
      END IF;

      INSERT INTO tracks (
        spotify_track_id, title, artist, artists, album,
        album_art_url, duration_ms, preview_url, uri
      )
      VALUES (
        v_track_id,
        v_track->>'title',
        COALESCE(v_track->>'artist', ''),
        v_artists,
        v_track->>'album',
        v_track->>'albumArtUrl',
        (v_track->>'durationMs')::INT,
        v_track->>'previewUrl',
        v_track->>'uri'
      )
      ON CONFLICT (spotify_track_id) DO UPDATE SET
        title         = EXCLUDED.title,
        artist        = EXCLUDED.artist,
        artists       = EXCLUDED.artists,
        album         = EXCLUDED.album,
        album_art_url = EXCLUDED.album_art_url,
        duration_ms   = EXCLUDED.duration_ms,
        preview_url   = EXCLUDED.preview_url,
        uri           = EXCLUDED.uri;
    END IF;

    -- Upsert the swipe row. ON CONFLICT targets the unique constraint on
    -- (session_id, spotify_track_id). The library-written flag is sticky-true so
    -- an out-of-order or later plain re-post never clears a confirmed write.
    INSERT INTO swipes (session_id, user_id, spotify_track_id, status, liked_songs_written_by_us)
    VALUES (v_session_id, p_user_id, v_track_id, v_status, v_lib_written)
    ON CONFLICT (session_id, spotify_track_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      liked_songs_written_by_us =
        swipes.liked_songs_written_by_us OR EXCLUDED.liked_songs_written_by_us
    RETURNING id, xmax INTO v_swipe_id, v_xmax;

    IF v_xmax = 0 THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_updated := v_updated + 1;
    END IF;

    -- Replace destinations: delete existing rows, then insert the new set.
    DELETE FROM swipe_destinations WHERE swipe_id = v_swipe_id;

    FOREACH v_dest_id IN ARRAY v_dest_ids
    LOOP
      INSERT INTO swipe_destinations (swipe_id, spotify_playlist_id)
      VALUES (v_swipe_id, v_dest_id);
    END LOOP;
  END LOOP;

  -- Reconcile dangling 'pending' rows in the SAME transaction as the upserts (M4).
  -- For every track decided in this batch, drop any leftover 'pending' row for the
  -- same user whose session targets the SAME source playlist — those are stale
  -- defer rows from an earlier session that the GET decide-later fetch would
  -- otherwise resurface. The rows just upserted above are already decided, so the
  -- status='pending' guard excludes them. Pending rows for other playlists are
  -- left untouched.
  WITH decided AS (
    SELECT DISTINCT
      sess.source_playlist_id AS playlist_id,
      elem->>'spotifyTrackId'  AS track_id
    FROM jsonb_array_elements(p_swipes) AS elem
    JOIN sessions sess ON sess.id = (elem->>'sessionId')::UUID
    WHERE elem->>'status' IN ('liked', 'super_liked', 'skipped')
      AND sess.source_playlist_id IS NOT NULL
  )
  DELETE FROM swipes s
  USING sessions sess, decided d
  WHERE s.user_id = p_user_id
    AND s.status = 'pending'
    AND s.session_id = sess.id
    AND sess.source_playlist_id = d.playlist_id
    AND s.spotify_track_id = d.track_id;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$$;
