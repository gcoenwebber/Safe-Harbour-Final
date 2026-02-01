import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './CreateOrganization.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function CreateOrganization() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '',
        domain: '',
        creator_name: '',
        creator_email: '',
        creator_password: '',
        confirm_password: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<{
        organization: { id: string; name: string };
        invite_code: string;
        creator: { uin: string };
    } | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name || !formData.creator_name || !formData.creator_email || !formData.creator_password) {
            setError('Please fill in all required fields');
            return;
        }

        if (formData.creator_password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        if (formData.creator_password !== formData.confirm_password) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await fetch(`${API_BASE}/api/organizations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name,
                    domain: formData.domain,
                    creator_name: formData.creator_name,
                    creator_email: formData.creator_email,
                    creator_password: formData.creator_password
                })
            });

            const data = await res.json();

            if (res.ok) {
                setResult(data);
            } else {
                setError(data.error || 'Failed to create organization');
            }
        } catch (err) {
            setError('Failed to create organization. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (result) {
        return (
            <div className="create-org-container">
                <div className="create-org-card success">
                    <div className="success-icon">✅</div>
                    <h1>Organization Created!</h1>

                    <div className="result-section">
                        <label>Organization</label>
                        <div className="result-value">{result.organization.name}</div>
                    </div>

                    <div className="result-section highlight">
                        <label>Your Invite Code</label>
                        <div className="invite-code-display">{result.invite_code}</div>
                        <p className="invite-hint">
                            Share this code with your employees so they can join
                        </p>
                    </div>

                    <div className="result-section">
                        <label>Your UIN</label>
                        <div className="result-value uin">{result.creator.uin}</div>
                        <p className="invite-hint">
                            You are the Admin and Presiding Officer
                        </p>
                    </div>

                    <button
                        className="continue-btn"
                        onClick={() => navigate('/auth')}
                    >
                        Continue to Login
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="create-org-container">
            <div className="create-org-card">
                <div className="create-org-header">
                    <button className="back-btn" onClick={() => navigate('/auth')}>
                        ← Back
                    </button>
                    <div className="header-icon">🏢</div>
                    <h1>Create Organization</h1>
                    <p>Set up your organization for POSH compliance</p>
                </div>

                <form onSubmit={handleSubmit} className="create-org-form">
                    <div className="form-group">
                        <label>Organization Name *</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Acme Corporation"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Email Domain (optional)</label>
                        <input
                            type="text"
                            value={formData.domain}
                            onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                            placeholder="acme.com"
                        />
                        <span className="field-hint">
                            Employees with this email domain can join without a code
                        </span>
                    </div>

                    <div className="form-divider">
                        <span>Your Details (Admin)</span>
                    </div>

                    <div className="form-group">
                        <label>Your Full Name *</label>
                        <input
                            type="text"
                            value={formData.creator_name}
                            onChange={(e) => setFormData({ ...formData, creator_name: e.target.value })}
                            placeholder="John Smith"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Your Email *</label>
                        <input
                            type="email"
                            value={formData.creator_email}
                            onChange={(e) => setFormData({ ...formData, creator_email: e.target.value })}
                            placeholder="john@acme.com"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Password *</label>
                        <input
                            type="password"
                            value={formData.creator_password}
                            onChange={(e) => setFormData({ ...formData, creator_password: e.target.value })}
                            placeholder="Minimum 6 characters"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Confirm Password *</label>
                        <input
                            type="password"
                            value={formData.confirm_password}
                            onChange={(e) => setFormData({ ...formData, confirm_password: e.target.value })}
                            placeholder="Confirm your password"
                            required
                        />
                    </div>

                    {error && <div className="form-error">{error}</div>}

                    <button type="submit" className="submit-btn" disabled={loading}>
                        {loading ? 'Creating...' : 'Create Organization'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default CreateOrganization;
