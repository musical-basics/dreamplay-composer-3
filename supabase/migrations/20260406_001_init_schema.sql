-- ============================================================
-- DreamPlay Composer — Initial Schema (reconstructed)
-- Schema: composer
-- Run date: 2026-04-06
-- Notes: This is a best-effort reconstruction of the schema
--        that existed before migration tracking was introduced.
--        Do NOT re-run — tables already exist.
-- ============================================================

-- composer.configurations
-- Main table for song/composition configs
CREATE TABLE IF NOT EXISTS composer.configurations (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id         TEXT,
    title           TEXT NOT NULL DEFAULT 'Untitled',
    audio_url       TEXT NOT NULL DEFAULT '',
    xml_url         TEXT NOT NULL DEFAULT '',
    midi_url        TEXT,
    thumbnail_url   TEXT,
    anchors         JSONB NOT NULL DEFAULT '[]',
    ai_anchors      JSONB,
    beat_anchors    JSONB,
    subdivision     INTEGER,
    is_level2       BOOLEAN,
    is_published    BOOLEAN NOT NULL DEFAULT false,
    view_count      INTEGER NOT NULL DEFAULT 0,
    music_font      TEXT,
    difficulty      TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- composer.profiles
-- Creator profile data (username, bio, socials, avatar)
CREATE TABLE IF NOT EXISTS composer.profiles (
    user_id             TEXT PRIMARY KEY,
    custom_username     TEXT UNIQUE,
    bio                 TEXT,
    twitter_url         TEXT,
    instagram_url       TEXT,
    youtube_url         TEXT,
    website_url         TEXT,
    avatar_url          TEXT,
    featured_config_id  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
