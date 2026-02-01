import { useState } from 'react';
import { formatCaseTokenInput, isValidCaseToken } from '../../utils/caseToken';
import ChatRoom from '../Chat/ChatRoom';
import './VictimDashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ReportStatus {
    status: 'pending' | 'investigating' | 'resolved';
    incident_type: string;
    created_at: string;
    closed_at: string | null;
}

export function VictimDashboard() {
    const [caseToken, setCaseToken] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reportStatus, setReportStatus] = useState<ReportStatus | null>(null);
    const [showChat, setShowChat] = useState(false);

    const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatCaseTokenInput(e.target.value);
        setCaseToken(formatted);
        setError(null);
        setReportStatus(null);
        setShowChat(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setReportStatus(null);

        if (!isValidCaseToken(caseToken)) {
            setError('Please enter a valid case token (XXXX-XXXX-XXXX-XXXX)');
            return;
        }

        setIsLoading(true);

        try {
            const response = await fetch(`${API_BASE}/api/reports/${caseToken}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Report not found');
            }

            setReportStatus(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending': return '#f59e0b';
            case 'investigating': return '#3b82f6';
            case 'resolved': return '#22c55e';
            default: return '#9ca3af';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending': return 'Pending Review';
            case 'investigating': return 'Under Investigation';
            case 'resolved': return 'Resolved';
            default: return status;
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="dashboard-container">
            <div className="dashboard-header">
                <div className="dashboard-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                </div>
                <h1>Report Status</h1>
                <p>Enter your Case Token to check the progress of your report</p>
            </div>

            <div className="dashboard-card">
                <form onSubmit={handleSubmit} className="token-form">
                    <div className="token-input-group">
                        <input
                            type="text"
                            value={caseToken}
                            onChange={handleTokenChange}
                            placeholder="XXXX-XXXX-XXXX-XXXX"
                            className="token-input"
                            maxLength={19}
                        />
                        <button type="submit" className="check-button" disabled={isLoading}>
                            {isLoading ? (
                                <span className="spinner"></span>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {error && (
                        <div className="dashboard-error">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            {error}
                        </div>
                    )}
                </form>

                {reportStatus && (
                    <div className="status-result">
                        <div className="status-badge" style={{ backgroundColor: getStatusColor(reportStatus.status) }}>
                            {getStatusLabel(reportStatus.status)}
                        </div>

                        <div className="status-details">
                            <div className="detail-row">
                                <span className="detail-label">Incident Type</span>
                                <span className="detail-value">{reportStatus.incident_type}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Submitted</span>
                                <span className="detail-value">{formatDate(reportStatus.created_at)}</span>
                            </div>
                            {reportStatus.closed_at && (
                                <div className="detail-row">
                                    <span className="detail-label">Closed</span>
                                    <span className="detail-value">{formatDate(reportStatus.closed_at)}</span>
                                </div>
                            )}
                        </div>

                        {reportStatus.status !== 'resolved' && (
                            <button
                                className="chat-toggle-btn"
                                onClick={() => setShowChat(!showChat)}
                            >
                                {showChat ? '✕ Close Chat' : '💬 Chat with Reviewer'}
                            </button>
                        )}
                    </div>
                )}

                {showChat && reportStatus && (
                    <div className="chat-section">
                        <ChatRoom
                            caseToken={caseToken}
                            userType="victim"
                            onClose={() => setShowChat(false)}
                        />
                    </div>
                )}

                <div className="privacy-notice">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <p>Your reports are not linked to your profile. Only you can access them using your Case Token.</p>
                </div>
            </div>
        </div>
    );
}

export default VictimDashboard;

