import { CheckIcon, WarningIcon } from './icons';
import CloseButton from './CloseButton';

// Renders the toast produced by useActionToast(). Reuses CartFeedback's
// .cart-toast styling (already loaded app-wide) — same pill shape, just
// confirming something other than a cart change.
export default function ActionToast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div
      className={`cart-toast cart-toast-${toast.type}${toast.leaving ? ' is-leaving' : ''}`}
      role="status"
    >
      <span className="cart-toast-icon">
        {toast.type === 'warning' ? <WarningIcon /> : <CheckIcon />}
      </span>
      <span className="cart-toast-text">{toast.message}</span>
      <CloseButton className="cart-toast-close" label="Dismiss" onClick={onClose} />
    </div>
  );
}
