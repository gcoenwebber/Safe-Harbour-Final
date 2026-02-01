import { useState, useEffect } from 'react';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import './AuthPage.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface OrgInfo {
    id: string;
    name: string;
    domain?: string;
}

export function AuthPage() {
    const { session } = useAuth();
    const navigate = useNavigate();
    const [step, setStep] = useState<'org-code' | 'auth'>('org-code');
    const [mode, setMode] = useState<'login' | 'signup'>('signup'); // Default to signup for new users
    const [orgCode, setOrgCode] = useState('');
    const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    // Form fields
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [username, setUsername] = useState('');

    // Redirect if already logged in
    useEffect(() => {
        if (session) {
            navigate('/');
        }
    }, [session, navigate]);

    const validateOrgCode = async () => {
        if (!orgCode.trim()) {
            setError('Please enter an organization code');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await fetch(`${API_BASE}/api/organizations/join/${orgCode.toUpperCase()}`);
            const data = await res.json();

            if (res.ok && data.valid) {
                setOrgInfo(data.organization);
                setStep('auth');
            } else {
                setError(data.error || 'Invalid organization code');
            }
        } catch (err) {
            setError('Failed to validate code. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                setError(error.message);
            }
        } catch (err) {
            setError('Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        username: username,
                        organization_id: orgInfo?.id,
                        org_code: orgCode
                    }
                }
            });

            if (error) {
                setError(error.message);
            } else {
                setMessage('Check your email for a confirmation link!');
            }
        } catch (err) {
            setError('Signup failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            validateOrgCode();
        }
    };

    // Step 1: Enter Org Code
    if (step === 'org-code') {
        return (
            <div className="auth-container">
                <div className="auth-card">
                    <div className="auth-header">
                        <div className="auth-logo">🛡️</div>
                        <h1>Safe Harbour</h1>
                        <p className="auth-subtitle">Anonymous POSH Compliance Platform</p>
                    </div>

                    <div className="org-code-section">
                        <h2>Enter Organization Code</h2>
                        <p className="org-code-hint">
                            Enter the 8-character code provided by your organization admin
                        </p>

                        <div className="org-code-input-wrapper">
                            <input
                                type="text"
                                value={orgCode}
                                onChange={(e) => setOrgCode(e.target.value.toUpperCase())}
                                onKeyPress={handleKeyPress}
                                placeholder="e.g., ABC12345"
                                maxLength={8}
                                className="org-code-input"
                                autoFocus
                            />
                        </div>

                        {error && <div className="auth-error">{error}</div>}

                        <button
                            onClick={validateOrgCode}
                            disabled={loading || orgCode.length !== 8}
                            className="validate-btn"
                        >
                            {loading ? 'Validating...' : 'Continue'}
                        </button>

                        <div className="auth-divider">
                            <span>or</span>
                        </div>

                        <button
                            onClick={() => navigate('/create-organization')}
                            className="create-org-btn"
                        >
                            Create New Organization
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Step 2: Login/Signup Form
    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-logo">🛡️</div>
                    <h1>Safe Harbour</h1>
                    {orgInfo && (
                        <div className="org-badge">
                            <span className="org-name">{orgInfo.name}</span>
                            <button
                                className="change-org-btn"
                                onClick={() => {
                                    setStep('org-code');
                                    setOrgInfo(null);
                                    setOrgCode('');
                                    setError('');
                                }}
                            >
                                Change
                            </button>
                        </div>
                    )}
                </div>

                <div className="auth-tabs">
                    <button
                        className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                        onClick={() => { setMode('login'); setError(''); setMessage(''); }}
                    >
                        Sign In
                    </button>
                    <button
                        className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
                        onClick={() => { setMode('signup'); setError(''); setMessage(''); }}
                    >
                        Sign Up
                    </button>
                </div>

                {message && <div className="auth-success">{message}</div>}
                {error && <div className="auth-error">{error}</div>}

                <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="auth-form">
                    {mode === 'signup' && (
                        <div className="form-group">
                            <label>Full Name</label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="John Smith"
                                required
                            />
                        </div>
                    )}

                    {mode === 'signup' && (
                        <div className="form-group">
                            <label>Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                placeholder="johnsmith"
                                required
                                minLength={3}
                                maxLength={30}
                            />
                            <span className="field-hint">Used for identification in reports (letters, numbers, underscores only)</span>
                        </div>
                    )}

                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            minLength={6}
                        />
                    </div>

                    <button type="submit" className="submit-btn" disabled={loading}>
                        {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Sign Up'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default AuthPage;

