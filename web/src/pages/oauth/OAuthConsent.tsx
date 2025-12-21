import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import './OAuthConsent.css';

export default function OAuthConsent() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function handleOAuthCallback() {
            try {
                // Get the code from URL params
                const code = searchParams.get('code');
                const error_description = searchParams.get('error_description');

                if (error_description) {
                    setError(error_description);
                    setLoading(false);
                    return;
                }

                if (code) {
                    // Exchange code for session
                    const { error } = await supabase.auth.exchangeCodeForSession(code);

                    if (error) {
                        setError(error.message);
                        setLoading(false);
                        return;
                    }

                    // Redirect to dashboard on success
                    navigate('/dashboard');
                } else {
                    // No code, check if already authenticated
                    const { data: { session } } = await supabase.auth.getSession();

                    if (session) {
                        navigate('/dashboard');
                    } else {
                        setError('No authorization code received');
                        setLoading(false);
                    }
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An error occurred');
                setLoading(false);
            }
        }

        handleOAuthCallback();
    }, [searchParams, navigate]);

    if (loading) {
        return (
            <div className="oauth-consent">
                <div className="oauth-loading">
                    <div className="spinner"></div>
                    <p>Authenticating...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="oauth-consent">
                <div className="oauth-error">
                    <h2>Authentication Error</h2>
                    <p>{error}</p>
                    <button onClick={() => navigate('/login')} className="btn btn-primary">
                        Back to Login
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
