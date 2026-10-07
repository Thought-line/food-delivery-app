import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';

export default function ProtectedRoute({ children, role }) {
  const { user, role: userRole } = useAuth();
  const location = useLocation();

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    const loginPath = role === 'admin' ? '/admin/login' : '/login';
    return <Navigate to={`${loginPath}?next=${next}`} replace />;
  }
  if (role && userRole !== role) return <Navigate to="/" replace />;
  return children;
}
