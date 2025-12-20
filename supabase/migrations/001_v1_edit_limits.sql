-- ============================================
-- V1 Migration: Edit Limits & Project Persistence
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================

-- Add file persistence columns to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vocal_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS beat_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS reference_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS latest_render_path TEXT;

-- Add edit tracking
ALTER TABLE projects ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;

-- Add premium status (simple boolean for V1)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;
