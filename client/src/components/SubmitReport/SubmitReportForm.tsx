import { useState, useEffect, useCallback } from 'react';
import { MentionInput } from './MentionInput';
import { CaseTokenModal } from './CaseTokenModal';
import './SubmitReportForm.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface FormData {
    email: string;
    incident_type: 'physical' | 'verbal' | 'psychological' | '';
    content: string;
    interim_relief: string[];
    organization_id: string;
}

interface MentionValidation {
    hasMention: boolean;
    isValidating: boolean;
    isValid: boolean | null;
    mentionText: string;
}

const INTERIM_RELIEF_OPTIONS = [
    { id: 'transfer', label: 'Transfer to different department' },
    { id: 'paid_leave', label: 'Paid leave during investigation' },
    { id: 'schedule_change', label: 'Schedule/shift change' },
    { id: 'remote_work', label: 'Remote work arrangement' },
    { id: 'other', label: 'Other relief measures' }
];

export function SubmitReportForm() {
    const [formData, setFormData] = useState<FormData>({
        email: '',
        incident_type: '',
        content: '',
        interim_relief: [],
        organization_id: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [caseToken, setCaseToken] = useState('');
    const [mentionValidation, setMentionValidation] = useState<MentionValidation>({
        hasMention: false,
        isValidating: false,
        isValid: null,
        mentionText: ''
    });

    // Extract mention from content - supports both formats:
    // 1. @[DisplayName](UIN) - from autocomplete
    // 2. @username - typed manually
    const extractMention = (content: string): { type: 'uin' | 'username' | null; value: string | null; display: string } => {
        // First try autocomplete format: @[Name](UIN)
        const uinMatch = content.match(/@\[([^\]]+)\]\((\d+)\)/);
        if (uinMatch) {
            return { type: 'uin', value: uinMatch[2], display: uinMatch[1] };
        }

        // Then try manual format: @username
        const usernameMatch = content.match(/@([a-zA-Z0-9._-]+)/);
        if (usernameMatch) {
            return { type: 'username', value: usernameMatch[1], display: usernameMatch[1] };
        }

        return { type: null, value: null, display: '' };
    };

    // Validate mention exists in database
    const validateMention = useCallback(async (content: string, orgId: string) => {
        const mention = extractMention(content);

        if (!mention.type || !mention.value) {
            setMentionValidation({
                hasMention: false,
                isValidating: false,
                isValid: null,
                mentionText: ''
            });
            return;
        }

        // If it's from autocomplete (@[Name](UIN)), trust it's valid - it came from our dropdown
        if (mention.type === 'uin') {
            setMentionValidation({
                hasMention: true,
                isValidating: false,
                isValid: true,  // Trust autocomplete selections
                mentionText: mention.display
            });
            return;
        }

        // For manual @username entry, validate it exists
        setMentionValidation(prev => ({
            ...prev,
            hasMention: true,
            isValidating: true,
            mentionText: mention.display
        }));

        try {
            // Search for the mentioned user by name
            const params = new URLSearchParams({ q: mention.value });
            if (orgId) params.append('org', orgId);

            const response = await fetch(`${API_BASE}/api/directory/search?${params}`);
            const results = await response.json();

            // Check if we found any matching user
            const isValid = results.length > 0;

            setMentionValidation({
                hasMention: true,
                isValidating: false,
                isValid,
                mentionText: mention.display
            });
        } catch {
            setMentionValidation({
                hasMention: true,
                isValidating: false,
                isValid: false,
                mentionText: mention.display
            });
        }
    }, []);

    // Debounced validation when content changes
    useEffect(() => {
        const timer = setTimeout(() => {
            if (formData.content) {
                validateMention(formData.content, formData.organization_id);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [formData.content, formData.organization_id, validateMention]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Validate
        if (!formData.email || !formData.incident_type || !formData.content || !formData.organization_id) {
            setError('Please fill in all required fields');
            return;
        }

        const mention = extractMention(formData.content);
        if (!mention.type || !mention.value) {
            setError('Please @mention the person you are reporting (type @ and select from suggestions)');
            return;
        }

        setIsSubmitting(true);

        try {
            const response = await fetch(`${API_BASE}/api/reports`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: formData.email,
                    content: formData.content,
                    incident_type: formData.incident_type,
                    interim_relief: formData.interim_relief,
                    organization_id: formData.organization_id
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit report');
            }

            // Show success modal with case token
            setCaseToken(data.case_token);
            setShowModal(true);

            // Reset form
            setFormData({
                email: '',
                incident_type: '',
                content: '',
                interim_relief: [],
                organization_id: ''
            });

        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReliefChange = (reliefId: string) => {
        setFormData(prev => ({
            ...prev,
            interim_relief: prev.interim_relief.includes(reliefId)
                ? prev.interim_relief.filter(r => r !== reliefId)
                : [...prev.interim_relief, reliefId]
        }));
    };

    return (
        <div className="submit-report-container">
            <div className="form-header">
                <h1>Submit a Report</h1>
                <p>Your report will be handled confidentially under POSH guidelines</p>
            </div>

            <form onSubmit={handleSubmit} className="report-form">
                {error && (
                    <div className="error-message">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        {error}
                    </div>
                )}

                <div className="form-group">
                    <label htmlFor="email">Your Email *</label>
                    <input
                        type="email"
                        id="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="Enter your registered email"
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="organization_id">Organization ID *</label>
                    <input
                        type="text"
                        id="organization_id"
                        value={formData.organization_id}
                        onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })}
                        placeholder="Enter organization UUID"
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="incident_type">Incident Type (POSH Category) *</label>
                    <select
                        id="incident_type"
                        value={formData.incident_type}
                        onChange={(e) => setFormData({ ...formData, incident_type: e.target.value as FormData['incident_type'] })}
                        required
                    >
                        <option value="">Select incident type</option>
                        <option value="physical">Physical Harassment</option>
                        <option value="verbal">Verbal Harassment</option>
                        <option value="psychological">Psychological Harassment</option>
                    </select>
                </div>

                <div className="form-group">
                    <label>Report Details *</label>
                    <p className="field-hint">Use @ to mention the person you are reporting</p>
                    <MentionInput
                        value={formData.content}
                        onChange={(value) => setFormData({ ...formData, content: value })}
                        placeholder="Describe the incident. Type @ to mention the person involved..."
                        organizationId={formData.organization_id}
                    />
                    {/* Mention Validation Indicator */}
                    {mentionValidation.hasMention && (
                        <div className={`mention-validation ${mentionValidation.isValid === true ? 'valid' : mentionValidation.isValid === false ? 'invalid' : ''}`}>
                            {mentionValidation.isValidating ? (
                                <span className="validating">🔄 Checking @{mentionValidation.mentionText}...</span>
                            ) : mentionValidation.isValid === true ? (
                                <span className="valid">✅ @{mentionValidation.mentionText} found</span>
                            ) : mentionValidation.isValid === false ? (
                                <span className="invalid">❌ @{mentionValidation.mentionText} not found - please select from suggestions</span>
                            ) : null}
                        </div>
                    )}
                </div>

                <div className="form-group">
                    <label>Request Interim Relief (Optional)</label>
                    <p className="field-hint">Select any interim measures you would like during the investigation</p>
                    <div className="relief-options">
                        {INTERIM_RELIEF_OPTIONS.map(option => (
                            <label key={option.id} className="relief-option">
                                <input
                                    type="checkbox"
                                    checked={formData.interim_relief.includes(option.id)}
                                    onChange={() => handleReliefChange(option.id)}
                                />
                                <span className="checkbox-custom"></span>
                                <span>{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <button type="submit" className="submit-button" disabled={isSubmitting}>
                    {isSubmitting ? (
                        <>
                            <span className="spinner"></span>
                            Submitting...
                        </>
                    ) : (
                        'Submit Report'
                    )}
                </button>
            </form>

            <CaseTokenModal
                isOpen={showModal}
                caseToken={caseToken}
                onClose={() => setShowModal(false)}
            />
        </div>
    );
}

export default SubmitReportForm;
