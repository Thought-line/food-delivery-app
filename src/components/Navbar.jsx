import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { useCart } from '../lib/useCart';
import { useAuthGate } from '../lib/useAuthGate';
import { useWishlist } from '../lib/useWishlist';
import { useRentalRange } from '../lib/useRentalRange';
import { useSearchUI } from '../lib/useSearchUI';
import { useBookingNotifications } from '../lib/useBookingNotifications';
import { toISODate, isoToLocalDate } from '../lib/dateUtils';
import BrandLogo from './ui/BrandLogo';
import ProfileMenu from './ui/ProfileMenu';
import DateRangePicker from './DateRangePicker';
import { SearchIcon } from './ui/icons';
import './Navbar.css';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const { items, removedCameraIds, openCart } = useCart();
  const { requireAuth } = useAuthGate();
  const { count: wishlistCount } = useWishlist();
  const { range, setRange, hasPicked } = useRentalRange();
  const { toggle: toggleSearch } = useSearchUI();
  const { unseenCount } = useBookingNotifications();
  // Number of *different* cameras in the cart, not total units — a camera
  // bumped from qty 1 to 2 shouldn't move this number, only adding or fully
  // removing a camera should (see CartContext.addItem/removeItem, which
  // already keep one entry per camera). Cameras an admin has since removed
  // (removedCameraIds) don't count either — they're still shown in the cart
  // itself as "Unavailable", just not toward this badge.
  const cartCount = items.filter((item) => !removedCameraIds.has(item.camera.id)).length;
  // Navbar now renders on the public Home/details pages too, so `user` can be null.
  const displayName = user ? user.user_metadata?.full_name || user.email : null;

  // The icon itself always stays visible (same pattern as the "+" buttons
  // and wishlist hearts elsewhere) — only clicking it while logged out is
  // gated, so a signed-out visitor gets the login prompt instead of seeing
  // whatever's sitting in the (auth-agnostic, localStorage-backed) cart.
  function handleCartClick() {
    if (!requireAuth('/cart')) return; // same next path CartPage.jsx's own gate uses
    openCart();
  }

  return (
    <nav className="site-navbar">
      <BrandLogo to="/" />

      <div className="nav-date-picker">
        <DateRangePicker
          variant="pill"
          // Stays blank ("Start Date"/"End Date", no value) until the
          // customer actually picks a range — before that, `range` is just
          // the today/tomorrow default used to filter the catalogue, not a
          // real choice worth displaying as one.
          initialStart={hasPicked ? isoToLocalDate(range.start) : null}
          initialEnd={hasPicked ? isoToLocalDate(range.end) : null}
          onChange={(start, end) => setRange({ start: toISODate(start), end: toISODate(end) })}
        />
      </div>

      <div className="nav-actions">
        <button type="button" className="nav-search-btn" aria-label="Search cameras" onClick={toggleSearch}>
          <SearchIcon size={22} />
        </button>

        {user && (
          <Link to="/my-bookings" className="nav-bookings-link">
            My Bookings
            {unseenCount > 0 && (
              // key={unseenCount} restarts the pulse animation on each new
              // notification, same as the cart/wishlist badges.
              <span key={unseenCount} className="nav-badge">
                {unseenCount}
              </span>
            )}
          </Link>
        )}
        {user && (
          <Link to="/wishlist" className="nav-wishlist-link">
            My Wishlist
            {wishlistCount > 0 && (
              // key={wishlistCount} restarts the pulse animation on each
              // add/remove, same as the cart badge below.
              <span key={wishlistCount} className="nav-badge">
                {wishlistCount}
              </span>
            )}
          </Link>
        )}

        <button type="button" className="nav-cart-link" aria-label="Cart" onClick={handleCartClick}>
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
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
          {cartCount > 0 && (
            // key={cartCount} remounts the badge whenever a camera is added or
            // fully removed, which restarts its CSS entrance animation — a
            // simple, state-free way to make it "pulse" on those changes only
            // (not on quantity-only updates, which don't touch this number).
            <span key={cartCount} className="nav-badge">
              {cartCount}
            </span>
          )}
        </button>

        {user ? (
          <ProfileMenu displayName={displayName} onLogout={signOut} profileHref="/profile" />
        ) : (
          <Link to="/login" className="nav-login-link">
            <span className="nav-login-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M4.5 19.2c1.4-3.1 4.2-4.9 7.5-4.9s6.1 1.8 7.5 4.9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            Hi, Login
          </Link>
        )}
      </div>
    </nav>
  );
}
