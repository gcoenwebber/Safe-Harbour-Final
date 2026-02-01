import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './Navigation.css';

export function Navigation() {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, userMeta, signOut } = useAuth();
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const isActive = (path: string) => location.pathname === path;

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLogout = async () => {
        await signOut();
        navigate('/auth');
    };

    const handleSwitchAccount = async () => {
        await signOut();
        navigate('/auth');
    };

    // Get display name and username from user metadata
    const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
    const username = user?.user_metadata?.username || userMeta?.uin || '-';
    const email = user?.email || '';

    return (
        <nav className="main-nav">
            <div className="nav-container">
                <Link to="/" className="nav-logo">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span>Safe Harbour</span>
                </Link>

                <div className="nav-links">
                    <Link
                        to="/submit-report"
                        className={`nav-link ${isActive('/submit-report') ? 'active' : ''}`}
                    >
                        Submit Report
                    </Link>
                    <Link
                        to="/dashboard"
                        className={`nav-link ${isActive('/dashboard') ? 'active' : ''}`}
                    >
                        Dashboard
                    </Link>
                    <Link
                        to="/ic-dashboard"
                        className={`nav-link ${isActive('/ic-dashboard') ? 'active' : ''}`}
                    >
                        IC Panel
                    </Link>
                </div>

                {/* Profile Dropdown */}
                <div className="profile-section" ref={dropdownRef}>
                    <button
                        className="profile-btn"
                        onClick={() => setShowDropdown(!showDropdown)}
                    >
                        <div className="profile-avatar">
                            {displayName.charAt(0).toUpperCase()}
                        </div>
                        <svg className="profile-chevron" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>

                    {showDropdown && (
                        <div className="profile-dropdown">
                            <div className="profile-info">
                                <div className="profile-name">{displayName}</div>
                                <div className="profile-username">@{username}</div>
                                <div className="profile-email">{email}</div>
                            </div>
                            <div className="profile-divider"></div>
                            <button className="profile-menu-item" onClick={() => { setShowDropdown(false); navigate('/profile'); }}>
                                <svg viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                </svg>
                                View Profile
                            </button>
                            <button className="profile-menu-item" onClick={handleSwitchAccount}>
                                <svg viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4z" clipRule="evenodd" />
                                </svg>
                                Switch Account
                            </button>
                            <div className="profile-divider"></div>
                            <button className="profile-menu-item logout" onClick={handleLogout}>
                                <svg viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
                                </svg>
                                Logout
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
}

export default Navigation;

