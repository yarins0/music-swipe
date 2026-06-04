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
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_track_id TEXT  UNIQUE NOT NULL,
  title            TEXT  NOT NULL,
  artist           TEXT  NOT NULL,
  album            TEXT,
  album_art_url    TEXT,
  duration_ms      INT,
  preview_url      TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  source_playlist_id TEXT        NOT NULL,
  started_at         TIMESTAMPTZ DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  swiped_count       INT         DEFAULT 0,
  liked_count        INT         DEFAULT 0,
  super_liked_count  INT         DEFAULT 0
);

CREATE TABLE IF NOT EXISTS swipes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  user_id          UUID        REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  spotify_track_id TEXT        NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('liked', 'super_liked', 'skipped', 'pending')),
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
-- Atomically upserts a batch of swipes and replaces their swipe_destinations,
-- all within a single transaction. Called from the Express backend via
-- supabase.rpc('upsert_swipes', { p_user_id, p_swipes }).
--
-- p_swipes JSON array shape:
--   [{ "sessionId": uuid, "spotifyTrackId": text, "status": text,
--      "destinationPlaylistIds": text[] }, ...]
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
