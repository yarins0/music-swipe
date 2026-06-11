-- MusicSwipe PostgreSQL schema
-- Run this against your Supabase project to initialize the database.
-- Tables must be created in order to satisfy foreign key constraints.

CREATE TABLE IF NOT EXISTS users (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id      UUID        UNIQUE NOT NULL,
  spotify_user_id  TEXT        UNIQUE NOT NULL,
  display_name     TEXT,
  email            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlists (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_id TEXT        UNIQUE NOT NULL,
  owner_id            UUID        REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT        NOT NULL,
  cover_art_url       TEXT,
  track_count         INT,
  cached_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracks (
  id               UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_track_id TEXT   UNIQUE NOT NULL,
  title            TEXT   NOT NULL,
  artist           TEXT   NOT NULL,
  artists          TEXT[] NOT NULL DEFAULT '{}',
  album            TEXT,
  album_art_url    TEXT,
  duration_ms      INT,
  preview_url      TEXT,
  uri              TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID        REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  source_playlist_id         TEXT        NOT NULL,
  source_playlist_name       TEXT,
  destination_playlist_ids   TEXT[]      NOT NULL DEFAULT '{}',
  destination_playlist_names TEXT[]      NOT NULL DEFAULT '{}',
  is_filter_mode             BOOLEAN     NOT NULL DEFAULT false,
  resume_offset              INT         NOT NULL DEFAULT 0,
  total_tracks               INT         NOT NULL DEFAULT 0,
  status                     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  started_at                 TIMESTAMPTZ DEFAULT now(),
  ended_at                   TIMESTAMPTZ,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  swiped_count               INT         DEFAULT 0,
  liked_count                INT         DEFAULT 0,
  super_liked_count          INT         DEFAULT 0
);

CREATE TABLE IF NOT EXISTS swipes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  user_id          UUID        REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  spotify_track_id TEXT        NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('liked', 'super_liked', 'skipped', 'pending')),
  -- Whether WE added this track to Liked Songs (not pre-existing). Persisted so a
  -- restored super-like / Liked-Songs row can still be removed on cancel after a
  -- device clear (migration 0003).
  liked_songs_written_by_us BOOLEAN NOT NULL DEFAULT false,
  swiped_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, spotify_track_id)
);

CREATE TABLE IF NOT EXISTS swipe_destinations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swipe_id            UUID REFERENCES swipes(id) ON DELETE CASCADE NOT NULL,
  spotify_playlist_id TEXT NOT NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_swipes_session    ON swipes(session_id);
CREATE INDEX IF NOT EXISTS idx_swipes_user_status ON swipes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_swipes_pending    ON swipes(user_id, spotify_track_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_swipe_destinations_swipe ON swipe_destinations(swipe_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- upsert_swipes(p_user_id, p_swipes)
--
-- Atomically upserts a batch of swipes, replaces their swipe_destinations, and
-- reconciles dangling 'pending' rows — all within a single transaction. Called
-- from the Express backend via supabase.rpc('upsert_swipes', { p_user_id, p_swipes }).
--
-- This is the consolidated final definition (migrations 0001–0004). A fresh
-- database built from this file alone is identical to one built by applying the
-- migrations in order.
--
-- p_swipes JSON array shape (track + likedSongsWrittenByUs are OPTIONAL):
--   [{ "sessionId": uuid, "spotifyTrackId": text, "status": text,
--      "destinationPlaylistIds": text[],
--      "likedSongsWrittenByUs": boolean,                       -- migration 0003
--      "track": { "uri": text, "title": text, "artist": text, "artists": text[],
--                 "album": text, "albumArtUrl": text, "durationMs": int,
--                 "previewUrl": text } }, ...]                  -- migration 0002
--
-- - When "track" is present (non-null title), its metadata is upserted into
--   `tracks` (deduped by UNIQUE(spotify_track_id)) before the swipe upsert.
-- - "likedSongsWrittenByUs" is kept sticky-true on conflict so an out-of-order
--   or later plain re-post never clears a confirmed library write.
-- - After the upserts, dangling 'pending' rows for any track decided in this
--   batch (same user, same source playlist, different session) are deleted in
--   the same transaction (migration 0004), so a later decide-later fetch can't
--   resurface a track that was already decided.
--
-- Returned counts are SWIPES ONLY.
--
-- Returns: { "inserted": n, "updated": m }
-- ---------------------------------------------------------------------------
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

    -- Optional track metadata upsert (skipped when absent / null title).
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
