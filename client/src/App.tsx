import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navigation from './components/Navigation/Navigation';
import HomePage from './pages/HomePage';
import SubmitReportPage from './pages/SubmitReportPage';
import DashboardPage from './pages/DashboardPage';
import ICDashboardPage from './pages/ICDashboardPage';
import AuthPage from './pages/AuthPage';
import CreateOrganization from './pages/CreateOrganization';
import './App.css';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { session } = useAuth();

  return (
    <div className="app">
      {session && <Navigation />}
      <main className="main-content">
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/create-organization" element={<CreateOrganization />} />
          <Route path="/" element={session ? <HomePage /> : <Navigate to="/auth" />} />
          <Route path="/submit-report" element={
            <ProtectedRoute><SubmitReportPage /></ProtectedRoute>
          } />
          <Route path="/dashboard" element={
            <ProtectedRoute><DashboardPage /></ProtectedRoute>
          } />
          <Route path="/ic-dashboard" element={
            <ProtectedRoute><ICDashboardPage /></ProtectedRoute>
          } />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
