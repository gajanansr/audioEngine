import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import './Dashboard.css';

interface Project {
    id: string;
    name: string;
    genre: string;
    created_at: string;
    updated_at: string;
}

export default function Dashboard() {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [newProjectName, setNewProjectName] = useState('');
    const [showNewProject, setShowNewProject] = useState(false);

    useEffect(() => {
        fetchProjects();
    }, []);

    const fetchProjects = async () => {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false });

        if (!error && data) {
            setProjects(data);
        }
        setLoading(false);
    };

    const createProject = async () => {
        if (!newProjectName.trim() || !user) return;

        const { data, error } = await supabase
            .from('projects')
            .insert({ name: newProjectName, user_id: user.id })
            .select()
            .single();

        if (!error && data) {
            navigate(`/editor/${data.id}`);
        }
    };

    return (
        <div className="dashboard-page">
            <header className="dashboard-header">
                <div className="header-left">
                    <h1 className="logo">AutoMix</h1>
                </div>
                <div className="header-right">
                    <span className="user-email">{user?.email}</span>
                    <button className="btn btn-secondary" onClick={signOut}>
                        Sign Out
                    </button>
                </div>
            </header>

            <main className="dashboard-main">
                <div className="container">
                    <div className="section-header">
                        <h2>Your Projects</h2>
                        <button
                            className="btn btn-primary"
                            onClick={() => setShowNewProject(true)}
                        >
                            + New Project
                        </button>
                    </div>

                    {showNewProject && (
                        <div className="new-project-form card">
                            <input
                                type="text"
                                className="input"
                                placeholder="Project name..."
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                                autoFocus
                            />
                            <div className="form-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowNewProject(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={createProject}
                                >
                                    Create
                                </button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="loading">Loading projects...</div>
                    ) : projects.length === 0 ? (
                        <div className="empty-state card">
                            <h3>No projects yet</h3>
                            <p>Create your first project to start mixing!</p>
                        </div>
                    ) : (
                        <div className="projects-grid">
                            {projects.map((project) => (
                                <div
                                    key={project.id}
                                    className="project-card card"
                                    onClick={() => navigate(`/editor/${project.id}`)}
                                >
                                    <h3>{project.name}</h3>
                                    <span className="project-genre">{project.genre}</span>
                                    <span className="project-date">
                                        {new Date(project.updated_at).toLocaleDateString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
