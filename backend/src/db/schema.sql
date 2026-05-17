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
  swiped_at        TIMESTAMPTZ DEFAULT now()
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
