import { useState, useEffect, useCallback } from 'react';
import ChatRoom from '../Chat/ChatRoom';
import './ICDashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Report {
    id: string;
    case_token: string;
    victim_uin: string;
    subject_uin: string;
    content: string;
    incident_type: string;
    interim_relief: string[];
    status: string;
    created_at: string;
    deadline_at?: string;
    extension_count?: number;
}

interface ApprovalVote {
    approver_uin: string;
    approver_role: string;
    vote: string;
    created_at: string;
}

interface PendingApproval {
    id: string;
    action_type: string;
    status: string;
    required_approvals: number;
    has_po_approval: boolean;
    approval_votes: ApprovalVote[];
}

interface ICDashboardProps {
    organizationId: string;
    currentUserUin: string;
    currentUserRole: 'presiding_officer' | 'member';
}

const ACTION_LABELS: Record<string, string> = {
    close_case: 'Close Case',
    reveal_identity: 'Reveal Identity',
    grant_paid_leave: 'Grant Paid Leave',
    recommend_transfer: 'Recommend Transfer',
    restructure_reporting: 'Restructure Reporting Line'
};

export function ICDashboard({ organizationId, currentUserUin, currentUserRole }: ICDashboardProps) {
    const [reports, setReports] = useState<Report[]>([]);
    const [selectedReport, setSelectedReport] = useState<Report | null>(null);
    const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [showChat, setShowChat] = useState(false);
    const [showExtendModal, setShowExtendModal] = useState(false);
    const [extendReason, setExtendReason] = useState('');
    const [extendDays, setExtendDays] = useState(30);

    const fetchReports = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/ic/reports?organization_id=${organizationId}`);
            const data = await res.json();
            if (res.ok) {
                setReports(data);
            }
        } catch (error) {
            console.error('Error fetching reports:', error);
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    const fetchPendingApprovals = useCallback(async (reportId: string) => {
        try {
            const res = await fetch(`${API_BASE}/api/ic/actions/${reportId}`);
            const data = await res.json();
            if (res.ok) {
                setPendingApprovals(data);
            }
        } catch (error) {
            console.error('Error fetching approvals:', error);
        }
    }, []);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    useEffect(() => {
        if (selectedReport) {
            fetchPendingApprovals(selectedReport.id);
        } else {
            setPendingApprovals([]);
        }
    }, [selectedReport, fetchPendingApprovals]);

    const initiateAction = async (actionType: string) => {
        if (!selectedReport) return;

        setActionLoading(actionType);
        setMessage(null);

        try {
            const res = await fetch(`${API_BASE}/api/ic/actions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    report_id: selectedReport.id,
                    action_type: actionType,
                    actor_uin: currentUserUin
                })
            });

            const data = await res.json();

            if (res.ok) {
                setMessage({
                    type: 'success',
                    text: data.requires_quorum
                        ? `Approval request created. ${data.current_approvals}/${data.required_approvals} approvals.`
                        : 'Action executed successfully!'
                });
                fetchPendingApprovals(selectedReport.id);
                fetchReports();
            } else {
                setMessage({ type: 'error', text: data.error });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to perform action' });
        } finally {
            setActionLoading(null);
        }
    };

    const castVote = async (approvalId: string) => {
        setMessage(null);

        try {
            const res = await fetch(`${API_BASE}/api/ic/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    approval_id: approvalId,
                    approver_uin: currentUserUin,
                    vote: 'approve'
                })
            });

            const data = await res.json();

            if (res.ok) {
                setMessage({
                    type: 'success',
                    text: data.quorum_met
                        ? 'Quorum met! Action executed.'
                        : `Vote recorded. ${data.current_approvals}/${data.required_approvals} approvals.`
                });
                if (selectedReport) {
                    fetchPendingApprovals(selectedReport.id);
                    fetchReports();
                }
            } else {
                setMessage({ type: 'error', text: data.error });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to cast vote' });
        }
    };

    const extendTimeline = async () => {
        if (!selectedReport) return;

        if (extendReason.trim().length < 20) {
            setMessage({ type: 'error', text: 'Reason must be at least 20 characters' });
            return;
        }

        setActionLoading('extend');
        setMessage(null);

        try {
            const res = await fetch(`${API_BASE}/api/ic/extend-timeline`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    report_id: selectedReport.id,
                    actor_uin: currentUserUin,
                    reason: extendReason,
                    extend_days: extendDays
                })
            });

            const data = await res.json();

            if (res.ok) {
                setMessage({
                    type: 'success',
                    text: `Timeline extended to ${new Date(data.new_deadline).toLocaleDateString()}`
                });
                setShowExtendModal(false);
                setExtendReason('');
                fetchReports();
            } else {
                setMessage({ type: 'error', text: data.error });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to extend timeline' });
        } finally {
            setActionLoading(null);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="ic-dashboard">
            <header className="ic-header">
                <h1>Internal Committee Dashboard</h1>
                <div className="ic-user-badge">
                    <span className={`role-badge ${currentUserRole}`}>
                        {currentUserRole === 'presiding_officer' ? 'Presiding Officer' : 'IC Member'}
                    </span>
                    <span className="uin-badge">UIN: {currentUserUin}</span>
                </div>
            </header>

            <div className="ic-content">
                <aside className="reports-list">
                    <h2>Reports</h2>
                    {loading ? (
                        <div className="loading">Loading reports...</div>
                    ) : reports.length === 0 ? (
                        <div className="empty-state">No reports to review</div>
                    ) : (
                        <ul>
                            {reports.map(report => (
                                <li
                                    key={report.id}
                                    className={`report-item ${selectedReport?.id === report.id ? 'selected' : ''} ${report.status}`}
                                    onClick={() => setSelectedReport(report)}
                                >
                                    <div className="report-meta">
                                        <span className={`status-badge ${report.status}`}>{report.status}</span>
                                        <span className="incident-type">{report.incident_type}</span>
                                    </div>
                                    <div className="report-date">{formatDate(report.created_at)}</div>
                                    <div className="report-uins">
                                        Victim: {report.victim_uin} → Subject: {report.subject_uin}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </aside>

                <main className="report-detail">
                    {selectedReport ? (
                        <>
                            <section className="report-info">
                                <h2>Report Details</h2>
                                <div className="info-grid">
                                    <div className="info-item">
                                        <label>Status</label>
                                        <span className={`status-badge ${selectedReport.status}`}>
                                            {selectedReport.status}
                                        </span>
                                    </div>
                                    <div className="info-item">
                                        <label>Incident Type</label>
                                        <span>{selectedReport.incident_type}</span>
                                    </div>
                                    <div className="info-item">
                                        <label>Victim UIN</label>
                                        <span className="uin">{selectedReport.victim_uin}</span>
                                    </div>
                                    <div className="info-item">
                                        <label>Subject UIN</label>
                                        <span className="uin">{selectedReport.subject_uin}</span>
                                    </div>
                                </div>
                                <div className="report-content">
                                    <label>Anonymized Content</label>
                                    <p>{selectedReport.content}</p>
                                </div>
                                {selectedReport.interim_relief?.length > 0 && (
                                    <div className="relief-granted">
                                        <label>Interim Relief Granted</label>
                                        <ul>
                                            {selectedReport.interim_relief.map((r, i) => (
                                                <li key={i}>{ACTION_LABELS[r] || r}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </section>

                            {message && (
                                <div className={`message ${message.type}`}>
                                    {message.text}
                                </div>
                            )}

                            {pendingApprovals.length > 0 && (
                                <section className="pending-approvals">
                                    <h3>Pending Approvals</h3>
                                    {pendingApprovals.map(approval => (
                                        <div key={approval.id} className="approval-card">
                                            <div className="approval-header">
                                                <span className="approval-action">{ACTION_LABELS[approval.action_type]}</span>
                                                <span className="approval-count">
                                                    {approval.approval_votes.length}/{approval.required_approvals} approvals
                                                </span>
                                            </div>
                                            <div className="quorum-status">
                                                <span className={`po-status ${approval.has_po_approval ? 'yes' : 'no'}`}>
                                                    {approval.has_po_approval ? '✓ PO Approved' : '⏳ Needs PO Approval'}
                                                </span>
                                            </div>
                                            <div className="voters-list">
                                                {approval.approval_votes.map((vote, i) => (
                                                    <span key={i} className="voter">
                                                        {vote.approver_uin} ({vote.approver_role === 'presiding_officer' ? 'PO' : 'M'})
                                                    </span>
                                                ))}
                                            </div>
                                            {!approval.approval_votes.some(v => v.approver_uin === currentUserUin) && (
                                                <button
                                                    className="approve-btn"
                                                    onClick={() => castVote(approval.id)}
                                                >
                                                    Cast Approval Vote
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </section>
                            )}

                            <section className="action-panel">
                                <h3>Actions</h3>

                                <div className="action-group">
                                    <h4>Major Actions (Requires Quorum)</h4>
                                    <p className="quorum-info">Requires 3 IC member approvals including at least 1 Presiding Officer</p>
                                    <div className="action-buttons">
                                        <button
                                            className="action-btn danger"
                                            onClick={() => initiateAction('close_case')}
                                            disabled={actionLoading !== null || selectedReport.status === 'resolved'}
                                        >
                                            {actionLoading === 'close_case' ? 'Processing...' : 'Close Case'}
                                        </button>
                                        <button
                                            className="action-btn warning"
                                            onClick={() => initiateAction('reveal_identity')}
                                            disabled={actionLoading !== null}
                                        >
                                            {actionLoading === 'reveal_identity' ? 'Processing...' : 'Reveal Identity'}
                                        </button>
                                    </div>
                                </div>

                                <div className="action-group">
                                    <h4>Interim Relief (Immediate)</h4>
                                    <div className="action-buttons">
                                        <button
                                            className="action-btn relief"
                                            onClick={() => initiateAction('grant_paid_leave')}
                                            disabled={actionLoading !== null}
                                        >
                                            {actionLoading === 'grant_paid_leave' ? 'Processing...' : 'Grant Paid Leave'}
                                        </button>
                                        <button
                                            className="action-btn relief"
                                            onClick={() => initiateAction('recommend_transfer')}
                                            disabled={actionLoading !== null}
                                        >
                                            {actionLoading === 'recommend_transfer' ? 'Processing...' : 'Recommend Transfer'}
                                        </button>
                                        <button
                                            className="action-btn relief"
                                            onClick={() => initiateAction('restructure_reporting')}
                                            disabled={actionLoading !== null}
                                        >
                                            {actionLoading === 'restructure_reporting' ? 'Processing...' : 'Restructure Reporting'}
                                        </button>
                                    </div>
                                </div>

                                <div className="action-group">
                                    <h4>📅 Timeline Management</h4>
                                    {selectedReport.deadline_at && (
                                        <p className="deadline-info">
                                            Deadline: <strong>{formatDate(selectedReport.deadline_at)}</strong>
                                            {selectedReport.extension_count && selectedReport.extension_count > 0 && (
                                                <span className="extension-count"> ({selectedReport.extension_count} extension{selectedReport.extension_count > 1 ? 's' : ''})</span>
                                            )}
                                        </p>
                                    )}
                                    <div className="action-buttons">
                                        <button
                                            className="action-btn timeline"
                                            onClick={() => setShowExtendModal(true)}
                                            disabled={actionLoading !== null || selectedReport.status === 'resolved'}
                                        >
                                            Extend Timeline
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {showExtendModal && (
                                <div className="modal-overlay">
                                    <div className="extend-modal">
                                        <h3>📅 Extend Timeline</h3>
                                        <p className="modal-info">POSH legal limit is 90 days from submission</p>

                                        <div className="modal-field">
                                            <label>Extension Days</label>
                                            <select
                                                value={extendDays}
                                                onChange={(e) => setExtendDays(Number(e.target.value))}
                                            >
                                                <option value={7}>7 days</option>
                                                <option value={15}>15 days</option>
                                                <option value={30}>30 days</option>
                                            </select>
                                        </div>

                                        <div className="modal-field">
                                            <label>Reason for Delay (required, min 20 chars)</label>
                                            <textarea
                                                value={extendReason}
                                                onChange={(e) => setExtendReason(e.target.value)}
                                                placeholder="Please provide a detailed reason for the timeline extension..."
                                                rows={4}
                                            />
                                            <span className="char-count">{extendReason.length}/20 min</span>
                                        </div>

                                        <div className="modal-actions">
                                            <button
                                                className="cancel-btn"
                                                onClick={() => setShowExtendModal(false)}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                className="confirm-btn"
                                                onClick={extendTimeline}
                                                disabled={extendReason.trim().length < 20 || actionLoading !== null}
                                            >
                                                {actionLoading === 'extend' ? 'Extending...' : 'Extend Timeline'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <section className="chat-panel">
                                <div className="chat-panel-header">
                                    <h3>💬 Enquiry Chat</h3>
                                    <button
                                        className="chat-toggle"
                                        onClick={() => setShowChat(!showChat)}
                                    >
                                        {showChat ? 'Hide Chat' : 'Open Chat'}
                                    </button>
                                </div>
                                {showChat && selectedReport.case_token && (
                                    <ChatRoom
                                        caseToken={selectedReport.case_token}
                                        userType="reviewer"
                                        onClose={() => setShowChat(false)}
                                    />
                                )}
                            </section>
                        </>
                    ) : (
                        <div className="no-selection">
                            <div className="no-selection-icon">📋</div>
                            <p>Select a report to view details and take action</p>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

export default ICDashboard;
