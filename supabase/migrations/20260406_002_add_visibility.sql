-- ============================================================
-- Migration: Add visibility column to configurations
-- Schema: composer
-- Run date: 2026-04-06
-- Replaces the boolean is_published with a 3-state visibility:
--   'private'  → owner-only, no share link
--   'unlisted' → direct link works, not shown in gallery
--   'public'   → shown in Community Creations gallery
-- ============================================================

-- 1. Add the new column
ALTER TABLE composer.configurations
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'unlisted', 'public'));

-- 2. Migrate existing data
--    Previously published (is_published = true)  → 'public'
--    Previously draft    (is_published = false) → 'private'
UPDATE composer.configurations
  SET visibility = CASE
    WHEN is_published = true THEN 'public'
    ELSE 'private'
  END;
