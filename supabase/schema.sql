-- ============================================
-- AI Audio Mixing Engine - Supabase Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROJECTS TABLE
-- ============================================
-- Stores user projects (collections of tracks and mixes)

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    genre TEXT DEFAULT 'default',
    bpm INTEGER DEFAULT 120,
    key TEXT DEFAULT 'C',
    scale TEXT DEFAULT 'major',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies for projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
    ON projects FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own projects"
    ON projects FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
    ON projects FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
    ON projects FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- JOBS TABLE
-- ============================================
-- Stores audio processing job queue

CREATE TYPE job_status AS ENUM ('pending', 'processing', 'complete', 'failed');

CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status job_status DEFAULT 'pending',
    
    -- File paths in Supabase Storage
    vocal_path TEXT NOT NULL,
    beat_path TEXT,
    reference_path TEXT,
    render_path TEXT,
    
    -- Processing parameters (JSON)
    parameters JSONB DEFAULT '{}',
    user_macros JSONB DEFAULT '{"autotuneStrength": 35, "reverbAmount": 30, "vocalLoudness": 0, "polishAmount": 50}',
    
    -- Metadata
    error_message TEXT,
    worker_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- RLS policies for jobs
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs"
    ON jobs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own jobs"
    ON jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own jobs"
    ON jobs FOR UPDATE
    USING (auth.uid() = user_id);

-- ============================================
-- MIXES TABLE
-- ============================================
-- Stores completed mix metadata and versions

CREATE TABLE mixes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Mix metadata
    name TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    render_path TEXT NOT NULL,
    
    -- Processing snapshot
    parameters JSONB,
    user_macros JSONB,
    
    -- Audio analysis results
    loudness_lufs REAL,
    true_peak_db REAL,
    duration_seconds REAL,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies for mixes
ALTER TABLE mixes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mixes"
    ON mixes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own mixes"
    ON mixes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own mixes"
    ON mixes FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_project_id ON jobs(project_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_mixes_project_id ON mixes(project_id);

-- ============================================
-- STORAGE BUCKETS
-- ============================================
-- Run these via Supabase Dashboard or API

-- INSERT INTO storage.buckets (id, name, public) VALUES 
--     ('vocals', 'vocals', false),
--     ('beats', 'beats', false),
--     ('references', 'references', false),
--     ('renders', 'renders', false);

-- Storage policies (allow users to upload/download their own files)
-- Each file should be stored as: {user_id}/{project_id}/{filename}

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for projects
CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Function to notify worker of new job (optional - for real-time)
CREATE OR REPLACE FUNCTION notify_new_job()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('new_job', json_build_object(
        'job_id', NEW.id,
        'project_id', NEW.project_id,
        'user_id', NEW.user_id
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_notify_new
    AFTER INSERT ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_job();
