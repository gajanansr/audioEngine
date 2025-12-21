import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import MacroPanel from '../components/MacroPanel';
import FileUpload from '../components/FileUpload';
import PremiumModal from '../components/PremiumModal';
import './Editor.css';

interface UserMacros {
    autotuneStrength: number;
    reverbAmount: number;
    vocalLoudness: number;
    polishAmount: number;
    // Backing vocals (V2)
    backingVocalsEnabled?: boolean;
    backingVocalsType?: 'doubles' | 'harmonies' | 'full';
    backingVocalsAmount?: number;
}

interface Project {
    id: string;
    name: string;
    vocal_path: string | null;
    beat_path: string | null;
    reference_path: string | null;
    latest_render_path: string | null;
    edit_count: number;
    is_premium: boolean;
}

const FREE_EDIT_LIMIT = 3;

export default function Editor() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();

    // Project state
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editCount, setEditCount] = useState(0);
    const [isPremium, setIsPremium] = useState(false);
    const [showPremiumModal, setShowPremiumModal] = useState(false);

    // File states
    const [vocalFile, setVocalFile] = useState<File | null>(null);
    const [beatFile, setBeatFile] = useState<File | null>(null);
    const [refFile, setRefFile] = useState<File | null>(null);
    const [filesLocked, setFilesLocked] = useState(false);

    // Processing states
    const [processing, setProcessing] = useState(false);
    const [status, setStatus] = useState('Ready to mix');

    // Result states
    const [renderUrl, setRenderUrl] = useState<string | null>(null);
    const [latestRenderPath, setLatestRenderPath] = useState<string | null>(null);

    // Macro state
    const [macros, setMacros] = useState<UserMacros>({
        autotuneStrength: 30,
        reverbAmount: 25,
        vocalLoudness: 0,
        polishAmount: 50,
        backingVocalsEnabled: false,
        backingVocalsType: 'doubles',
        backingVocalsAmount: 50
    });

    const editsRemaining = FREE_EDIT_LIMIT - editCount;
    const canEdit = isPremium || editsRemaining > 0;

    // Fetch project on mount
    useEffect(() => {
        async function fetchProject() {
            if (!projectId) return;

            const { data, error } = await supabase
                .from('projects')
                .select('*')
                .eq('id', projectId)
                .single();

            if (error) {
                setError('Project not found');
            } else if (data) {
                setProject(data);
                setEditCount(data.edit_count || 0);
                setIsPremium(data.is_premium || false);
                setFilesLocked(!!data.vocal_path);
                setLatestRenderPath(data.latest_render_path);

                if (data.latest_render_path) {
                    const url = await getSignedUrl(data.latest_render_path);
                    if (url) setRenderUrl(url);
                }
            }
            setLoading(false);
        }

        fetchProject();
    }, [projectId]);

    const handleMacroChange = useCallback((name: keyof UserMacros, value: number | boolean | string) => {
        setMacros(prev => ({ ...prev, [name]: value }));
    }, []);

    const uploadFile = async (file: File, bucket: string): Promise<string> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const path = `${user.id}/${projectId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const { error } = await supabase.storage
            .from(bucket)
            .upload(path, file);

        if (error) throw error;
        return path;
    };

    const getSignedUrl = async (path: string): Promise<string | null> => {
        const { data, error } = await supabase.storage
            .from('renders')
            .createSignedUrl(path, 3600);

        if (error) {
            console.error('Failed to get signed URL:', error);
            return null;
        }
        return data.signedUrl;
    };

    const downloadRender = async () => {
        if (!latestRenderPath) return;

        const url = await getSignedUrl(latestRenderPath);
        if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.download = `mix_${new Date().toISOString().slice(0, 10)}.wav`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    const startProcessing = async () => {
        // Check edit limit
        if (!canEdit) {
            setShowPremiumModal(true);
            return;
        }

        // For new projects, require vocal file
        if (!filesLocked && !vocalFile) {
            setStatus('Please upload a vocal track');
            return;
        }

        setRenderUrl(null);
        setLatestRenderPath(null);
        setProcessing(true);
        setStatus('Uploading files...');

        try {
            let vocalPath: string;
            let beatPath: string | null = null;
            let refPath: string | null = null;

            if (filesLocked) {
                // Use existing files from project
                vocalPath = project!.vocal_path!;
                beatPath = project!.beat_path;
                refPath = project!.reference_path;
                setStatus('Creating remix job...');
            } else {
                // Upload new files
                vocalPath = await uploadFile(vocalFile!, 'vocals');
                beatPath = beatFile ? await uploadFile(beatFile, 'beats') : null;
                refPath = refFile ? await uploadFile(refFile, 'references') : null;
                setStatus('Creating job...');
            }

            // Create processing job
            const { data: { session } } = await supabase.auth.getSession();

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-job`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session?.access_token}`,
                    },
                    body: JSON.stringify({
                        project_id: projectId,
                        vocal_path: vocalPath,
                        beat_path: beatPath,
                        reference_path: refPath,
                        user_macros: macros,
                    }),
                }
            );

            const result = await response.json();

            if (!response.ok) {
                if (result.requires_premium) {
                    setShowPremiumModal(true);
                    setProcessing(false);
                    return;
                }
                throw new Error(result.error || 'Failed to create job');
            }

            // Update local edit count
            if (project) {
                setProject({
                    ...project,
                    edit_count: result.edit_count,
                    vocal_path: vocalPath,
                    beat_path: beatPath,
                    reference_path: refPath,
                });
            }

            setStatus(`Processing... (${result.edits_remaining} edits remaining)`);

            // Poll for job completion
            pollJobStatus(result.job_id);

        } catch (error) {
            console.error('Processing error:', error);
            setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setProcessing(false);
        }
    };

    const pollJobStatus = async (id: string) => {
        const interval = setInterval(async () => {
            const { data: job } = await supabase
                .from('jobs')
                .select('status, render_path, error_message')
                .eq('id', id)
                .single();

            if (job) {
                if (job.status === 'complete' && job.render_path) {
                    clearInterval(interval);
                    setStatus('✅ Processing complete!');
                    setProcessing(false);
                    setLatestRenderPath(job.render_path);

                    // Update project's latest render
                    await supabase
                        .from('projects')
                        .update({ latest_render_path: job.render_path })
                        .eq('id', projectId);

                    if (project) {
                        setProject({ ...project, latest_render_path: job.render_path });
                    }

                    const url = await getSignedUrl(job.render_path);
                    if (url) {
                        setRenderUrl(url);
                    }
                } else if (job.status === 'failed') {
                    clearInterval(interval);
                    setStatus(`❌ Processing failed: ${job.error_message}`);
                    setProcessing(false);
                } else {
                    setStatus(`Processing... (${job.status})`);
                }
            }
        }, 3000);
    };

    if (loading) {
        return (
            <div className="editor-page">
                <div className="loading-screen">
                    <div className="spinner"></div>
                    <p>Loading project...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="editor-page">
            <header className="editor-header">
                <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
                    ← Back
                </button>
                <h1>{project?.name || 'Project Editor'}</h1>
                <div className="header-actions">
                    {!project?.is_premium && (
                        <span className={`edit-badge ${editsRemaining === 0 ? 'badge-warning' : ''}`}>
                            {editsRemaining} edits left
                        </span>
                    )}
                    <button
                        className="btn btn-primary btn-lg"
                        onClick={startProcessing}
                        disabled={processing || (!filesLocked && !vocalFile)}
                    >
                        {processing ? 'Processing...' : filesLocked ? '🔄 Remix' : '🎵 Mix It!'}
                    </button>
                </div>
            </header>

            <main className="editor-main">
                <div className="editor-layout">
                    {/* Left: File uploads */}
                    <section className="upload-section card">
                        <h2>
                            Tracks
                            {filesLocked && <span className="locked-badge">🔒 Locked</span>}
                        </h2>

                        {filesLocked ? (
                            <div className="locked-files">
                                <div className="locked-file">
                                    <span className="file-icon">🎤</span>
                                    <span className="file-name">Vocal Track</span>
                                    <span className="file-status">✓ Uploaded</span>
                                </div>
                                {project?.beat_path && (
                                    <div className="locked-file">
                                        <span className="file-icon">🎹</span>
                                        <span className="file-name">Beat</span>
                                        <span className="file-status">✓ Uploaded</span>
                                    </div>
                                )}
                                {project?.reference_path && (
                                    <div className="locked-file">
                                        <span className="file-icon">🎧</span>
                                        <span className="file-name">Reference</span>
                                        <span className="file-status">✓ Uploaded</span>
                                    </div>
                                )}
                                <p className="locked-hint">
                                    Files are locked after first upload. Adjust the controls below and click Remix!
                                </p>
                            </div>
                        ) : (
                            <>
                                <FileUpload
                                    label="Vocal Track"
                                    accept="audio/*"
                                    file={vocalFile}
                                    onFileSelect={setVocalFile}
                                    required
                                />
                                <FileUpload
                                    label="Beat / Instrumental"
                                    accept="audio/*"
                                    file={beatFile}
                                    onFileSelect={setBeatFile}
                                />
                                <FileUpload
                                    label="Reference Track"
                                    accept="audio/*"
                                    file={refFile}
                                    onFileSelect={setRefFile}
                                    subtitle="Optional - for tone matching"
                                />
                            </>
                        )}
                    </section>

                    {/* Right: Macro controls */}
                    <section className="controls-section card">
                        <h2>Mix Controls</h2>
                        <MacroPanel macros={macros} onChange={handleMacroChange} />
                    </section>
                </div>

                {/* Status bar */}
                {status && (
                    <div className={`status-bar ${renderUrl ? 'status-success' : ''}`}>
                        {status}
                    </div>
                )}

                {/* Results section */}
                {renderUrl && (
                    <section className="results-section card">
                        <h2>🎧 Your Mix is Ready!</h2>

                        <div className="audio-player-wrapper">
                            <audio
                                controls
                                src={renderUrl}
                                className="audio-player"
                            >
                                Your browser does not support audio playback.
                            </audio>
                        </div>

                        <div className="results-actions">
                            <button
                                className="btn btn-primary btn-lg"
                                onClick={downloadRender}
                            >
                                ⬇️ Download WAV
                            </button>
                            {canEdit && (
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setRenderUrl(null);
                                        setLatestRenderPath(null);
                                        setStatus('');
                                    }}
                                >
                                    🔄 Adjust & Remix
                                </button>
                            )}
                        </div>
                    </section>
                )}
            </main>

            <PremiumModal
                isOpen={showPremiumModal}
                onClose={() => setShowPremiumModal(false)}
                editCount={editCount}
            />
        </div>
    );
}
