-- Migration 0003: Persist the "we wrote this to Liked Songs" bit per swipe.
--
-- Goal: make cancel-from-History remove a track from Liked Songs even after a
-- clear + restore. The client tracked this in a per-device AsyncStorage set
-- (PlaylistWriter.libraryWrittenIds), which is empty after a reinstall, so a
-- restored super-liked (or Liked-Songs-routed) record could not be removed from
-- the library on cancel. Persisting the bit lets the restore carry it back.
--
-- The flag is set asynchronously: a like/super-like posts its swipe first, then
-- the library write confirms later and the client re-posts the same swipe with
-- likedSongsWrittenByUs=true. Because the two posts can arrive in either order,
-- the upsert keeps the flag STICKY-TRUE (OR of old and new) so a later plain
-- re-post never clears a confirmation that already landed.
--
-- IMPORTANT — run in order on your Supabase project (SQL editor):
--   Step 1: ALTER swipes          (labelled "STEP 1")
--   Step 2: CREATE OR REPLACE upsert_swipes (labelled "STEP 2")
--
-- After applying, reload the PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE) and safe to re-run.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- STEP 1 — ALTER swipes: store whether WE added the track to Liked Songs.
-- Default false so all pre-existing rows remain valid.
-- ===========================================================================
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS liked_songs_written_by_us BOOLEAN NOT NULL DEFAULT false;

-- ===========================================================================
-- STEP 2 — Create (or replace) upsert_swipes with the optional flag.
--
-- Same signature (p_user_id UUID, p_swipes JSONB). Each p_swipes item MAY now
-- carry "likedSongsWrittenByUs": boolean (defaults to false when absent). On
-- conflict the flag is kept sticky-true: liked_songs_written_by_us =
-- swipes.liked_songs_written_by_us OR EXCLUDED.liked_songs_written_by_us.
--
-- The nested "track" metadata handling from migration 0002 is unchanged. The
-- returned { inserted, updated } contract is unchanged.
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

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$$;
