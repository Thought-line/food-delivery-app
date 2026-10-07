 import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fetchActiveCameras } from '../lib/cameras';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import { useCart } from '../lib/useCart';
import { useAuthGate } from '../lib/useAuthGate';
import { useWishlist } from '../lib/useWishlist';
import { useRentalRange } from '../lib/useRentalRange';
import { getBookedQuantitiesByCamera, getCameraRentalCounts } from '../lib/availability';
import { formatPrice } from '../lib/common';
import { todayISO, addDaysISO, formatDateHint } from '../lib/dateUtils';
import QuantityStepper from './QuantityStepper';
import Hero from './Hero';
import Loading from './ui/Loading';
import { HeartIcon } from './ui/icons';
import PhotoPlaceholder from './ui/PhotoPlaceholder';
import './CameraList.css';

// "New" = added within this many days (cameras.created_at).
const NEW_WINDOW_DAYS = 14;
// "Trending" = has at least this many real (confirmed/active/completed)
// bookings, all-time — see getCameraRentalCounts / get_camera_rental_counts.
const TRENDING_MIN_RENTALS = 3;

export default function CameraList({ onViewDetails }) {
  const {
    items,
    addItem,
    updateQuantity,
    removeItem,
    showToast,
    showMaxQuantityToast,
    openMaxQuantityDrawer,
  } = useCart();
  const { requireAuth } = useAuthGate();
  const { ids: wishlist, toggle: toggleWishlistId } = useWishlist(); // shared across navbar badge / My Wishlist too
  // Rental dates are picked once in the navbar (Navbar.jsx) and shared from
  // there — the catalogue just reads them. `hasPicked` tells apart a real
  // choice from the today/tomorrow default seeded before the customer ever
  // touches the picker (see RentalRangeProvider).
  const { range: queryRange, hasPicked } = useRentalRange();
  const location = useLocation();
  const [cameras, setCameras] = useState([]); // full camera list from Supabase
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function toggleWishlist(camera) {
    // Saving is part of a signed-in customer's account, same as booking/cart.
    if (
      !requireAuth(location.pathname + location.search, {
        title: 'Login required to save to wishlist',
        message: 'Please log in or create an account to save cameras to your wishlist.',
      })
    ) {
      return;
    }
    toggleWishlistId(camera.id);
  }

  const rangeRef = useRef(queryRange); // lets the realtime subscription always see the latest range without resubscribing
  useEffect(() => {
    rangeRef.current = queryRange;
  }, [queryRange]);
  async function loadCameras(range) {
    setLoading(true);
    setError(null);
    try {
      // These requests don't depend on each other, so run them
      // at the same time instead of waiting for one before starting the other.
      const [cams, bookedQuantities, rentalCounts] = await Promise.all([
        // Only cameras that are currently active (not removed)
        fetchActiveCameras(),
        // Total quantity booked out per camera for the selected date range
        // (sums quantity across overlapping confirmed/active bookings).
        getBookedQuantitiesByCamera(range.start, range.end),
        // All-time real rental counts, for the "Trending" badge.
        getCameraRentalCounts(),
      ]);

      const newCutoff = Date.now() - NEW_WINDOW_DAYS * 86400000;

      // Work out how many units of each camera are actually free right now
      setCameras(
        cams.map((c) => {
          const stock = c.stock_quantity ?? 0;
          const unitsAvailable = Math.max(0, stock - (bookedQuantities[c.id] ?? 0));
          return {
            ...c,
            unitsAvailable,
            availableNow: unitsAvailable > 0,
            isNew: Boolean(c.created_at) && new Date(c.created_at).getTime() >= newCutoff,
            isTrending: (rentalCounts[c.id] ?? 0) >= TRENDING_MIN_RENTALS,
          };
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Reload cameras whenever the applied date range changes.
  const hasLoadedOnceRef = useRef(false); // guards the scroll below off the initial mount
  useEffect(() => {
    if (!queryRange) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCameras(queryRange);
    // Only once dates are actually *changed* (not on first load) — bring the
    // results into view, since the navbar picker can be reached while
    // scrolled well past the grid.
    if (hasLoadedOnceRef.current) {
      document.getElementById('camera-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    hasLoadedOnceRef.current = true;
  }, [queryRange]);

  useEffect(() => {
    // Listen for any change to the bookings table (new booking, cancellation, etc.)
    // and reload cameras whenever that happens, so availability stays live.
    const channel = supabase
      .channel('bookings-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => {
          if (rangeRef.current) loadCameras(rangeRef.current);
        }
      )
      .subscribe();

    // Stop listening when this page is closed, to avoid a memory leak
    return () => supabase.removeChannel(channel);
  }, []);

  // Card body click / Enter — opens the full details page.
  function handleCardOpen(camera) {
    onViewDetails(camera, queryRange);
  }

  function handleAddFirstUnit(camera) {
    // Adding to the cart is part of booking, so it needs a login too.
    if (!requireAuth(location.pathname + location.search)) return;
    // Block adding with the still-default today/tomorrow range — a real
    // date pick in the navbar is required first, so the cart never holds
    // dates the customer never actually chose.
    if (!hasPicked) {
      showToast('warning', 'Please select your rental dates first');
      return;
    }
    addItem(camera, queryRange, 1);
    if (camera.unitsAvailable === 1) {
      showToast('warning', 'Maximum limit reached');
    }
  }

  function handleIncrement(camera, cartQuantity) {
    // Cart contents survive a logout (CartContext is localStorage-backed,
    // not auth-aware), so this stepper can still be showing (cartQuantity >
    // 0) for a now-signed-out visitor. Gate it the same way
    // handleAddFirstUnit already gates the very first add.
    if (!requireAuth(location.pathname + location.search)) return;
    if (cartQuantity < camera.unitsAvailable) {
      const newQuantity = cartQuantity + 1;
      updateQuantity(camera.id, newQuantity);
      // Reaching the cap on a successful add — different from clicking +
      // again afterward, which is blocked entirely (see the else branch).
      if (newQuantity === camera.unitsAvailable) {
        showToast('warning', 'Maximum limit reached');
      }
    } else {
      openMaxQuantityDrawer(camera, queryRange);
      showMaxQuantityToast(`Max quantity of ${camera.unitsAvailable} reached for this item.`);
    }
  }

  function handleDecrement(camera, cartQuantity) {
    if (cartQuantity <= 1) {
      removeItem(camera.id);
    } else {
      updateQuantity(camera.id, cartQuantity - 1);
    }
  }

  const rangeLabel = useMemo(() => {
    if (!queryRange) return '';
    const isDefaultToday =
      queryRange.start === todayISO() && queryRange.end === addDaysISO(todayISO(), 1);
    if (isDefaultToday) return 'Available Products';
    return `Showing availability: ${formatDateHint(queryRange.start)} → ${formatDateHint(queryRange.end)}`;
  }, [queryRange]);

  // The grid only lists cameras actually available for the selected dates —
  // an unavailable one is still reachable via its own details page (a
  // direct link, browser history, or search), just not listed here.
  // `cameras` itself stays the full fetched list so the empty-state message
  // below can tell "catalogue is empty" apart from "nothing's free for
  // these dates."
  const availableCameras = useMemo(() => cameras.filter((c) => c.availableNow), [cameras]);

  return (
    <div className="camera-list">
      <Hero />

      {/* This wrapper (not the grid itself) is the scroll target above — it
          stays mounted through the loading/error/empty/populated states, so
          the smooth-scroll on a date change always has something to land
          on, instead of scrolling toward a grid that's about to be replaced
          by the loading spinner mid-animation (which cut the scroll short). */}
      <div id="camera-grid">
        {loading ? (
          <Loading label="Loading cameras…" />
        ) : error ? (
          <p role="alert">Couldn't load cameras: {error}</p>
        ) : (
          <>
            <div className="camera-list-header">
              <h2 className="camera-list-title">{rangeLabel}</h2>
              <span className="camera-list-count">
                Total items: {availableCameras.length} item{availableCameras.length === 1 ? '' : 's'}
              </span>
            </div>

            {availableCameras.length === 0 ? (
              <p>
                {cameras.length === 0
                  ? 'No cameras available right now.'
                  : 'No cameras available for the selected dates. Try different dates.'}
              </p>
            ) : (
              <div className="camera-grid">
                {availableCameras.map((camera) => {
                  const photo = getCameraPhotoUrl(camera);
                  const cartQuantity = items.find((i) => i.camera.id === camera.id)?.quantity ?? 0;
                  const wishlisted = wishlist.has(camera.id);
                  return (
                    // Whole card (except the footer controls) opens the details
                    // page; the explicit buttons below handle booking and cart.
                    <div
                      key={camera.id}
                      className="camera-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleCardOpen(camera)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') handleCardOpen(camera);
                      }}
                    >
                      <div className="camera-card-top">
                        <div className="camera-badges">
                          <span className={camera.availableNow ? 'camera-status-pill' : 'camera-status-pill is-off'}>
                            {camera.availableNow ? 'Available' : 'Unavailable'}
                          </span>
                          {/* At most one of these — a camera could technically be
                              both, but Trending (proven repeat demand) is the
                              more meaningful signal to lead with. */}
                          {camera.isTrending ? (
                            <span className="camera-badge-trending">Trending</span>
                          ) : (
                            camera.isNew && <span className="camera-badge-new">New</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={wishlisted ? 'camera-wishlist-btn is-active' : 'camera-wishlist-btn'}
                          aria-label={wishlisted ? `Remove ${camera.name} from wishlist` : `Add ${camera.name} to wishlist`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWishlist(camera);
                          }}
                        >
                          <HeartIcon filled={wishlisted} />
                        </button>
                      </div>

                      <div className="camera-thumb">
                        {photo ? (
                          <img src={photo} alt={`${camera.name} (${camera.model})`} loading="lazy" />
                        ) : (
                          <PhotoPlaceholder size={36} className="camera-thumb-placeholder" />
                        )}
                      </div>
                      <div className="camera-info">
                        <h3>{camera.name}</h3>

                        <div
                          className="camera-card-footer"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {camera.price > 0 && (
                            <div className="price-block">
                              <div className="price-amount">
                                {formatPrice(camera.price)}
                                <span className="price-unit">/day</span>
                              </div>
                              <div className="price-subtext">Incl. of GST</div>
                            </div>
                          )}
                          {camera.availableNow &&
                            (cartQuantity === 0 ? (
                              <button
                                type="button"
                                className="camera-add-btn"
                                aria-label={`Add ${camera.name} to cart`}
                                onClick={() => handleAddFirstUnit(camera)}
                              >
                                +
                              </button>
                            ) : (
                              <QuantityStepper
                                quantity={cartQuantity}
                                available={camera.unitsAvailable}
                                onIncrement={() => handleIncrement(camera, cartQuantity)}
                                onDecrement={() => handleDecrement(camera, cartQuantity)}
                                min={0}
                              />
                            ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
