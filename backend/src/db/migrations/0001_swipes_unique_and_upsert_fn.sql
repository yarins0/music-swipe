-- Migration 0001: Add UNIQUE(session_id, spotify_track_id) to swipes
--                 and create the upsert_swipes atomic-batch function.
--
-- IMPORTANT — run steps in this order on your Supabase project:
--
--   Step 1 (pre-dedup): deduplicate any existing rows that would violate
--          the new constraint (keep the most-recently swiped row per pair).
--          Run the block labelled "STEP 1" below BEFORE the rest.
--
--   Step 2: add the unique constraint (labelled "STEP 2").
--
--   Step 3: create / replace the upsert function (labelled "STEP 3").
--
-- Each step is idempotent where Postgres supports it (IF NOT EXISTS /
-- CREATE OR REPLACE). Step 1 is always safe to re-run.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- STEP 1 — Pre-dedup: remove duplicate (session_id, spotify_track_id) rows.
--
-- Keeps the row with the largest swiped_at (most recent) for each pair.
-- If two rows share the same swiped_at, the one with the greater UUID is kept
-- (arbitrary but deterministic).
--
-- Run this BEFORE Step 2. It is safe to run even if no duplicates exist.
-- ===========================================================================
DELETE FROM swipes
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY session_id, spotify_track_id
        ORDER BY swiped_at DESC, id DESC
      ) AS rn
    FROM swipes
  ) ranked
  WHERE rn > 1
);

-- ===========================================================================
-- STEP 2 — Add the unique constraint.
--
-- Uses IF NOT EXISTS so it is safe to re-run if the constraint already exists
-- (e.g. from a fresh schema.sql setup).
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = 'swipes'::regclass
    AND    contype  = 'u'
    AND    conname  = 'swipes_session_id_spotify_track_id_key'
  ) THEN
    ALTER TABLE swipes
      ADD CONSTRAINT swipes_session_id_spotify_track_id_key
      UNIQUE (session_id, spotify_track_id);
  END IF;
END;
$$;

-- ===========================================================================
-- STEP 3 — Create (or replace) the upsert_swipes function.
--
-- CREATE OR REPLACE is idempotent; safe to re-run at any time.
--
-- p_swipes JSON array shape:
--   [{ "sessionId": uuid, "spotifyTrackId": text, "status": text,
--      "destinationPlaylistIds": text[] }, ...]
--
-- Returns: { "inserted": n, "updated": m }
-- ===========================================================================
CREATE OR REPLACE FUNCTION upsert_swipes(
  p_user_id UUID,
  p_swipes  JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted   INT := 0;
  v_updated    INT := 0;
  v_item       JSONB;
  v_swipe_id   UUID;
  v_session_id UUID;
  v_track_id   TEXT;
  v_status     TEXT;
  v_dest_ids   TEXT[];
  v_dest_id    TEXT;
  v_xmax       BIGINT;
BEGIN
  FOR v_item IN SELECT jsonb_array_elements(p_swipes)
  LOOP
    v_session_id := (v_item->>'sessionId')::UUID;
    v_track_id   := v_item->>'spotifyTrackId';
    v_status     := v_item->>'status';

    -- Build destination array; treat missing/null as empty.
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(v_item->'destinationPlaylistIds')
    )
    INTO v_dest_ids;

    IF v_dest_ids IS NULL THEN
      v_dest_ids := '{}';
    END IF;

    -- Upsert the swipe row. ON CONFLICT targets the unique constraint on
    -- (session_id, spotify_track_id). We read xmax immediately after the
    -- INSERT ... RETURNING to distinguish insert (xmax = 0) from update.
    INSERT INTO swipes (session_id, user_id, spotify_track_id, status)
    VALUES (v_session_id, p_user_id, v_track_id, v_status)
    ON CONFLICT (session_id, spotify_track_id)
    DO UPDATE SET status = EXCLUDED.status
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

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$$;
