import { useAuth } from '../lib/useAuth';
import BrandLogo from './ui/BrandLogo';
import ProfileMenu from './ui/ProfileMenu';
import './AdminTopbar.css';

export default function AdminTopbar({ onLogout }) {
  const { user } = useAuth();
  const displayName = user.user_metadata?.full_name || user.email;

  return (
    <header className="admin-topbar">
      <BrandLogo to="/admin" />

      <div className="admin-topbar-actions">
        <ProfileMenu displayName={displayName} onLogout={onLogout} />
      </div>
    </header>
  );
}
