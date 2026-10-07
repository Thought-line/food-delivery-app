import { useEffect, useState } from 'react';
import { useCart } from '../lib/useCart';
import { CheckIcon, WarningIcon, ArrowIcon } from './ui/icons';
import CloseButton from './ui/CloseButton';
import './CartFeedback.css';

const TOAST_VISIBLE_MS = 2500;
const TOAST_EXIT_MS = 250;
const FAB_VISIBLE_MS = 4500;
const FAB_EXIT_MS = 250;

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.8h7.2a2 2 0 0 0 2-1.6L20 8H6"
      />
      <circle cx="9" cy="20" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="17" cy="20" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
} 
// Single, centralized cart notification: one pill toast top-center (no
// per-card indicators anywhere), plus a "Go to Cart" FAB when the toast
// represents cart growth. Mounted once (see App.jsx's AppLayout) so it
// reacts to cart changes triggered from anywhere in the app.
export default function CartFeedback() {
  const { toast, dismissToast, openCart, isCartOpen, maxQuantityContext } = useCart();
  const anyDrawerOpen = isCartOpen || Boolean(maxQuantityContext);

  const [display, setDisplay] = useState(null); // { type, message, leaving }
  const [fab, setFab] = useState(null); // { leaving }

  // Either drawer is its own notification surface (each has its own local
  // toast) — while one is open, this global toast/FAB stay hidden entirely,
  // and any toast that arrives is discarded immediately rather than queued,
  // so closing the drawer doesn't replay a stale one.
  useEffect(() => {
    if (!anyDrawerOpen) return;
    const timer = setTimeout(() => {
      setDisplay(null);
      setFab(null);
      dismissToast();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDrawerOpen]);

  useEffect(() => {
    if (!toast || anyDrawerOpen) return;

    // A new toast always replaces whatever's showing — setting `display`
    // here (rather than appending) is what makes this "no stacking".
    const showTimer = setTimeout(() => {
      setDisplay({ type: toast.type, message: toast.message, leaving: false });
      if (toast.showFab) setFab({ leaving: false });
    }, 0);

    const toastLeave = setTimeout(
      () => setDisplay((d) => (d ? { ...d, leaving: true } : d)),
      TOAST_VISIBLE_MS
    );
    const toastGone = setTimeout(() => {
      setDisplay(null);
      dismissToast();
    }, TOAST_VISIBLE_MS + TOAST_EXIT_MS);

    let fabLeave;
    let fabGone;
    if (toast.showFab) {
      fabLeave = setTimeout(() => setFab((f) => (f ? { ...f, leaving: true } : f)), FAB_VISIBLE_MS);
      fabGone = setTimeout(() => setFab(null), FAB_VISIBLE_MS + FAB_EXIT_MS);
    }

    return () => {
      clearTimeout(showTimer);
      clearTimeout(toastLeave);
      clearTimeout(toastGone);
      clearTimeout(fabLeave);
      clearTimeout(fabGone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  function handleCloseToast() {
    setDisplay((d) => (d ? { ...d, leaving: true } : d));
    setTimeout(() => {
      setDisplay(null);
      dismissToast();
    }, TOAST_EXIT_MS);
  }

  function handleFabClick() {
    setFab((f) => (f ? { ...f, leaving: true } : f));
    setTimeout(() => setFab(null), TOAST_EXIT_MS);
    openCart();
  }

  return (
    <>
      {display && (
        <div
          className={`cart-toast cart-toast-${display.type}${display.leaving ? ' is-leaving' : ''}`}
          role="status"
        >
          <span className="cart-toast-icon">
            {display.type === 'warning' ? <WarningIcon /> : <CheckIcon />}
          </span>
          <span className="cart-toast-text">{display.message}</span>
          <CloseButton className="cart-toast-close" label="Dismiss" onClick={handleCloseToast} />
        </div>
      )}

      {fab && (
        <button
          type="button"
          className={`cart-fab${fab.leaving ? ' is-leaving' : ''}`}
          onClick={handleFabClick}
        >
          <CartIcon />
          Go to Cart
          <ArrowIcon />
        </button>
      )}
    </>
  );
}
