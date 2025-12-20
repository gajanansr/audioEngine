/**
 * Supabase Database Types
 * Generated from schema.sql for TypeScript type safety
 */

export type JobStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface Project {
    id: string;
    user_id: string;
    name: string;
    genre: string;
    bpm: number;
    key: string;
    scale: string;
    created_at: string;
    updated_at: string;
}

export interface Job {
    id: string;
    project_id: string;
    user_id: string;
    status: JobStatus;
    vocal_path: string;
    beat_path: string | null;
    reference_path: string | null;
    render_path: string | null;
    parameters: Record<string, unknown>;
    user_macros: UserMacros;
    error_message: string | null;
    worker_id: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
}

export interface Mix {
    id: string;
    project_id: string;
    job_id: string | null;
    user_id: string;
    name: string;
    version: number;
    render_path: string;
    parameters: Record<string, unknown> | null;
    user_macros: UserMacros | null;
    loudness_lufs: number | null;
    true_peak_db: number | null;
    duration_seconds: number | null;
    created_at: string;
}

export interface UserMacros {
    autotuneStrength: number;
    reverbAmount: number;
    vocalLoudness: number;
    polishAmount: number;
}

// Insert types (for creating new records)
export interface ProjectInsert {
    name: string;
    genre?: string;
    bpm?: number;
    key?: string;
    scale?: string;
}

export interface JobInsert {
    project_id: string;
    vocal_path: string;
    beat_path?: string;
    reference_path?: string;
    parameters?: Record<string, unknown>;
    user_macros?: UserMacros;
}

export interface MixInsert {
    project_id: string;
    job_id?: string;
    name: string;
    render_path: string;
    parameters?: Record<string, unknown>;
    user_macros?: UserMacros;
}

// Database response types
export interface Database {
    public: {
        Tables: {
            projects: {
                Row: Project;
                Insert: ProjectInsert & { user_id?: string };
                Update: Partial<ProjectInsert>;
            };
            jobs: {
                Row: Job;
                Insert: JobInsert & { user_id?: string };
                Update: Partial<Job>;
            };
            mixes: {
                Row: Mix;
                Insert: MixInsert & { user_id?: string };
                Update: Partial<Mix>;
            };
        };
    };
}
