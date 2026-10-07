import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './ui/Modal';
import Button from './ui/Button';
import './ui/ConfirmDialog.css';
import './LoginRequiredModal.css';

// Shown by AuthGateProvider when a signed-out visitor tries to do something
// that needs an account. Login and Sign Up carry `next` along (only used to
// pass between the login/signup pages' own cross-links now — both always
// land on the home page once signed in, not back on `next`); "Continue
// Browsing" just closes. `title`/`message` default to the booking copy but
// any requireAuth call site can override them (see useAuthGate.js) to
// explain what it is they need to log in for.
export default function LoginRequiredModal({
  next,
  title = 'Login required to book a camera',
  message = 'Please login or create an account to continue.',
  onClose,
}) {
  const navigate = useNavigate();
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : '';

  // Close on Escape, matching the app's other dialogs.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <Modal overlayClassName="confirm-overlay" modalClassName="confirm-modal" onClose={onClose}>
      <h3>{title}</h3>
      <p>{message}</p>
      <div className="login-required-actions">
        <Button
          type="button"
          className="login-required-primary"
          onClick={() => navigate(`/login${nextQuery}`)}
        >
          Login
        </Button>
        <Button type="button" onClick={() => navigate(`/signup${nextQuery}`)}>
          Sign Up
        </Button>
        <Button type="button" className="confirm-modal-cancel" onClick={onClose}>
          Continue Browsing
        </Button>
      </div>
    </Modal>
  );
}
