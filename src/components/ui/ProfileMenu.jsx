import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, LogOut, ChevronDown } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import { useCart } from '../../lib/useCart';
import './ProfileMenu.css';

// "Dinesh Kanna" -> "D". Just the first letter of the name (or of the
// address, for an email fallback).
function getInitials(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  return trimmed[0].toUpperCase();
}

// Account button + dropdown, shared by the customer navbar and the admin
// topbar — the only difference between the two is who's logged in and what
// logging out does, so both are passed in as props. `profileHref` is only
// passed by the customer navbar — admins have no profile page, so
// AdminTopbar omits it and "My profile" (plus its divider) simply don't render.
export default function ProfileMenu({ displayName, onLogout, profileHref }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef(null);
  // Same shared toast the rest of the app uses (cart/wishlist/review
  // confirmations) — no reason to build a second one just for this.
  const { showToast } = useCart();

  // Click-to-open; closes on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  async function handleConfirmLogout() {
    setBusy(true);
    await onLogout();
    setBusy(false);
    setConfirmOpen(false);
    // Land on the public home page regardless of whether this was the
    // customer navbar or the admin topbar — a signed-out admin has nowhere
    // useful to stay on /admin anyway, and this beats bouncing through a
    // "please log in" redirect.
    navigate('/');
    showToast('success', 'Logged out successfully');
  }

  return (
    <div className="nav-profile" ref={rootRef}>
      <button
        type="button"
        className="nav-profile-btn"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        <span className="nav-profile-avatar">{getInitials(displayName)}</span>
        <span className="nav-profile-name">{displayName}</span>
        <ChevronDown size={16} className="nav-profile-chevron" aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className="nav-profile-menu" role="menu">
          {profileHref && (
            <Link
              to={profileHref}
              className="nav-profile-item"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
            >
              <User size={18} aria-hidden="true" />
              My profile
            </Link>
          )}

          {profileHref && <div className="nav-profile-divider" role="separator" />}

          <button
            type="button"
            className="nav-profile-item nav-profile-item-danger"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConfirmOpen(true);
            }}
          >
            <LogOut size={18} aria-hidden="true" />
            Log out
          </button>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          icon={<LogOut size={24} />}
          title="Log out?"
          description="oho no! You're leaving ."
          confirmLabel="yes, log out"
          confirmBusyLabel="Logging out…"
          cancelLabel="Naah, Just Kidding"
          modalClassName="confirm-modal logout-confirm-modal"
          actionsClassName="confirm-modal-actions logout-confirm-actions"
          confirmClassName="logout-confirm-primary"
          cancelClassName="logout-confirm-secondary"
          busy={busy}
          onConfirm={handleConfirmLogout}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
