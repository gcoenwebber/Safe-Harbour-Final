import { useEffect, useState } from 'react';
import ICDashboard from '../components/ICDashboard/ICDashboard';
import { useAuth } from '../context/AuthContext';
import './ICDashboardPage.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface UserInfo {
    uin: string;
    organization_id: string;
    role: string;
    ic_role?: string;
    full_name: string;
}

export function ICDashboardPage() {
    const { user, userMeta } = useAuth();
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Fetch user info from server using email
    useEffect(() => {
        async function fetchUserInfo() {
            if (!user?.email) {
                setLoading(false);
                setError('Not logged in');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/api/auth/lookup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: user.email })
                });

                if (!response.ok) {
                    setError('User not found in directory');
                    setLoading(false);
                    return;
                }

                const data = await response.json();
                setUserInfo(data.user);
            } catch (err) {
                console.error('Error fetching user info:', err);
                setError('Failed to load user info');
            } finally {
                setLoading(false);
            }
        }

        // Try to use cached metadata first, otherwise fetch
        if (userMeta.uin && userMeta.organization_id) {
            setUserInfo({
                uin: userMeta.uin,
                organization_id: userMeta.organization_id,
                role: userMeta.role || 'Employee',
                ic_role: userMeta.ic_role,
                full_name: userMeta.full_name || 'User'
            });
            setLoading(false);
        } else {
            fetchUserInfo();
        }
    }, [user, userMeta]);

    if (loading) {
        return (
            <div className="ic-dashboard-page loading">
                <div className="loading-spinner">Loading dashboard...</div>
            </div>
        );
    }

    if (error || !userInfo) {
        return (
            <div className="ic-dashboard-page error">
                <div className="error-message">
                    <h2>Unable to load dashboard</h2>
                    <p>{error || 'User information not available'}</p>
                    <p>Please make sure you are logged in with a valid account.</p>
                </div>
            </div>
        );
    }

    // Check if user has IC role
    const icRole = userInfo.ic_role as 'presiding_officer' | 'member' | undefined;
    if (!icRole) {
        return (
            <div className="ic-dashboard-page error">
                <div className="error-message">
                    <h2>Access Denied</h2>
                    <p>You are not a member of the Internal Committee.</p>
                    <p>Only IC members can access this dashboard.</p>
                </div>
            </div>
        );
    }

    return (
        <ICDashboard
            organizationId={userInfo.organization_id}
            currentUserUin={userInfo.uin}
            currentUserRole={icRole}
        />
    );
}

export default ICDashboardPage;
