-- Migration 0002: Backend-restorable sessions + liked-track metadata (M7).
--
-- Goal: let the History tab fully restore from the server on a fresh device /
-- reinstall. Two gaps are closed:
--   (a) `sessions` stored only source_playlist_id + counts — add the rest of the
--       client SessionEntry shape so a session card can be rebuilt server-side.
--   (b) swipes stored only spotify_track_id — add track metadata storage so a
--       restored liked-track row can render title/artist/art. The `tracks` table
--       existed but was unused and missing `uri` + `artists[]`.
--
-- IMPORTANT — run steps in this order on your Supabase project (SQL editor):
--   Step 1: ALTER sessions   (labelled "STEP 1")
--   Step 2: ALTER tracks     (labelled "STEP 2")  — must precede Step 3 so the
--           function body sees the new track columns.
--   Step 3: CREATE OR REPLACE upsert_swipes (labelled "STEP 3").
--
-- After applying, reload the PostgREST schema cache so the new columns are
-- visible to the REST API (avoids PGRST202 "column not found" on first calls):
--   NOTIFY pgrst, 'reload schema';
--
-- Every step is idempotent (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE) and
-- safe to re-run. Defaults keep all pre-existing rows valid.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- STEP 1 — ALTER sessions: store the full SessionEntry shape.
--
-- Defaults mirror the client's fresh-session values so existing rows (which
-- predate these columns) remain valid SessionEntry records after restore.
-- ===========================================================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source_playlist_name       TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS destination_playlist_ids   TEXT[]      NOT NULL DEFAULT '{}';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS destination_playlist_names TEXT[]      NOT NULL DEFAULT '{}';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_filter_mode             BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS resume_offset              INT         NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_tracks               INT         NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status                     TEXT        NOT NULL DEFAULT 'active';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now();

-- Constrain status to the two client values. Added separately + guarded so the
-- migration is re-runnable (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = 'sessions'::regclass
    AND    conname  = 'sessions_status_check'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_status_check
      CHECK (status IN ('active', 'completed'));
  END IF;
END;
$$;

-- ===========================================================================
-- STEP 2 — ALTER tracks: add the two fields the internal Track type needs
--          that the table lacked. `uri` drives playback; `artists` is the full
--          artist list (the existing `artist` column is the display string).
-- ===========================================================================
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS uri     TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artists TEXT[] NOT NULL DEFAULT '{}';

-- ===========================================================================
-- STEP 3 — Create (or replace) upsert_swipes with optional track metadata.
--
-- Same signature (p_user_id UUID, p_swipes JSONB) — CREATE OR REPLACE is
-- idempotent. Each p_swipes item MAY now carry a nested "track" object:
--   { "sessionId": uuid, "spotifyTrackId": text, "status": text,
--     "destinationPlaylistIds": text[],
--     "track": { "uri": text, "title": text, "artist": text,
--                "artists": text[], "album": text, "albumArtUrl": text,
--                "durationMs": int, "previewUrl": text } }
--
-- The track object is OPTIONAL (legacy/replayed payloads omit it). When present
-- with a non-null title, its metadata is upserted into `tracks` (deduped by
-- UNIQUE(spotify_track_id)) BEFORE the swipe upsert. Track metadata is upserted
-- for ALL statuses — skipped/pending rows never enter the restore payload, and
-- caching them is harmless and useful for cross-session reuse.
--
-- The single-transaction guarantee (M8) is preserved: track + swipe + destinations
-- all commit together. The returned counts continue to count SWIPES ONLY, so the
-- existing { inserted, updated } contract and tests are unchanged.
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
  v_track      JSONB;
  v_swipe_id   UUID;
  v_session_id UUID;
  v_track_id   TEXT;
  v_status     TEXT;
  v_dest_ids   TEXT[];
  v_dest_id    TEXT;
  v_artists    TEXT[];
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

    -- Optional track metadata upsert. Guarded so legacy payloads (no "track"
    -- key) and malformed ones (null title) are skipped without error. Runs
    -- before the swipe upsert so a restore query always finds the metadata.
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
