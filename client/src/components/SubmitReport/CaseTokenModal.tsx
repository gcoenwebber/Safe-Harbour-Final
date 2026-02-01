import { useState, useEffect } from 'react';
import './CaseTokenModal.css';

interface CaseTokenModalProps {
    isOpen: boolean;
    caseToken: string;
    onClose: () => void;
}

export function CaseTokenModal({ isOpen, caseToken, onClose }: CaseTokenModalProps) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (copied) {
            const timer = setTimeout(() => setCopied(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [copied]);

    if (!isOpen) return null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(caseToken);
            setCopied(true);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4" />
                        <circle cx="12" cy="12" r="10" />
                    </svg>
                </div>

                <h2 className="modal-title">Report Submitted Successfully</h2>

                <div className="modal-warning">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="warning-icon">
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p>Save this Case Token now. This is the <strong>only time</strong> it will be shown.</p>
                </div>

                <div className="case-token-display">
                    <span className="case-token-value">{caseToken}</span>
                    <button onClick={handleCopy} className="copy-button" title="Copy to clipboard">
                        {copied ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                            </svg>
                        )}
                    </button>
                </div>

                <p className="modal-info">
                    Use this token to check the progress of your report on the Dashboard.
                </p>

                <button onClick={onClose} className="modal-close-button">
                    I have saved my Case Token
                </button>
            </div>
        </div>
    );
}

export default CaseTokenModal;
