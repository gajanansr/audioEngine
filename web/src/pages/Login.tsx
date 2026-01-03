import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '../lib/supabase';
import './Login.css';

export default function Login() {
    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-header">
                    <h1 className="login-title">AutoMix</h1>
                    <p className="login-subtitle">
                        AI-Powered Vocal Mixing
                    </p>
                </div>

                <div className="login-card glass">
                    <Auth
                        supabaseClient={supabase}
                        appearance={{
                            theme: ThemeSupa,
                            variables: {
                                default: {
                                    colors: {
                                        brand: '#6366f1',
                                        brandAccent: '#8b5cf6',
                                        inputBackground: '#1a1a25',
                                        inputBorder: 'rgba(255,255,255,0.1)',
                                        inputText: '#ffffff',
                                    },
                                    radii: {
                                        borderRadiusButton: '10px',
                                        inputBorderRadius: '10px',
                                    },
                                },
                            },
                            style: {
                                button: {
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    border: 'none',
                                },
                                anchor: {
                                    color: '#8b5cf6',
                                },
                            },
                        }}
                        providers={[]}
                        redirectTo={`${window.location.origin}/dashboard`}
                    />
                </div>

                <p className="login-footer">
                    Transform phone vocals into studio-quality mixes
                </p>
            </div>
        </div>
    );
}
