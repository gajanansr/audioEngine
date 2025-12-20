// Supabase Edge Function: Create Job
// Deploy: supabase functions deploy create-job

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FREE_EDIT_LIMIT = 3;

interface CreateJobRequest {
    project_id: string;
    vocal_path: string;
    beat_path?: string;
    reference_path?: string;
    user_macros?: {
        autotuneStrength: number;
        reverbAmount: number;
        vocalLoudness: number;
        polishAmount: number;
    };
}

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Get auth token
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Initialize Supabase client with user's JWT
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        // Service client for updates (bypasses RLS)
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Get user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body
        const body: CreateJobRequest = await req.json();

        // Validate required fields
        if (!body.project_id || !body.vocal_path) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: project_id, vocal_path' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Fetch project with edit count and premium status
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, edit_count, is_premium, vocal_path')
            .eq('id', body.project_id)
            .eq('user_id', user.id)
            .single();

        if (projectError || !project) {
            return new Response(
                JSON.stringify({ error: 'Project not found or access denied' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Check edit limit (only if files already exist - meaning this is a remix)
        const isRemix = !!project.vocal_path;
        const currentEditCount = project.edit_count || 0;

        if (isRemix && currentEditCount >= FREE_EDIT_LIMIT && !project.is_premium) {
            return new Response(
                JSON.stringify({
                    error: 'Edit limit reached',
                    message: 'You have used all 3 free edits for this project. Upgrade to Premium for unlimited edits.',
                    edit_count: currentEditCount,
                    limit: FREE_EDIT_LIMIT,
                    requires_premium: true
                }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Create job
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .insert({
                project_id: body.project_id,
                user_id: user.id,
                vocal_path: body.vocal_path,
                beat_path: body.beat_path || null,
                reference_path: body.reference_path || null,
                user_macros: body.user_macros || {
                    autotuneStrength: 35,
                    reverbAmount: 30,
                    vocalLoudness: 0,
                    polishAmount: 50,
                },
                status: 'pending',
            })
            .select()
            .single();

        if (jobError) {
            console.error('Failed to create job:', jobError);
            return new Response(
                JSON.stringify({ error: 'Failed to create job', details: jobError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Update project: save file paths (first time) and increment edit count
        const projectUpdate: Record<string, unknown> = {
            edit_count: currentEditCount + 1,
        };

        // Only save file paths on first upload
        if (!project.vocal_path) {
            projectUpdate.vocal_path = body.vocal_path;
            if (body.beat_path) projectUpdate.beat_path = body.beat_path;
            if (body.reference_path) projectUpdate.reference_path = body.reference_path;
        }

        await supabaseAdmin
            .from('projects')
            .update(projectUpdate)
            .eq('id', body.project_id);

        return new Response(
            JSON.stringify({
                success: true,
                job_id: job.id,
                status: job.status,
                edit_count: currentEditCount + 1,
                edits_remaining: Math.max(0, FREE_EDIT_LIMIT - (currentEditCount + 1)),
                message: 'Job created successfully. Processing will begin shortly.',
            }),
            { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error in create-job function:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
