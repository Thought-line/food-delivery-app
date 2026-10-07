import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ShieldCheck, IndianRupee, Headset, PackageCheck, BadgePercent, Leaf, FileText } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuthGate } from '../lib/useAuthGate';
import { useCart } from '../lib/useCart';
import { useWishlist } from '../lib/useWishlist';
import { useRentalRange } from '../lib/useRentalRange';
import { getCameraPhotos, getCameraPhotoUrl } from '../lib/cameraPhotos';
import { getRemainingUnits, getBookedQuantitiesByCamera, STOCK_UNAVAILABLE_MESSAGE } from '../lib/availability';
import { fetchActiveCameras } from '../lib/cameras';
import { fetchReviewsForCamera } from '../lib/reviews';
import { formatPrice } from '../lib/common';
import { rentalDays } from '../lib/rentalDays';
import { CalendarIcon, ArrowIcon, HeartIcon } from '../components/ui/icons';
import StarRating from '../components/ui/StarRating';
import Loading from '../components/ui/Loading';
import PhotoPlaceholder from '../components/ui/PhotoPlaceholder';
import CloseButton from '../components/ui/CloseButton';
import PolicyDrawer from '../components/PolicyDrawer';
import TermsGateModal from '../components/TermsGateModal';
import './CameraDetailsPage.css';
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="18" cy="5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="19" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8.1 10.7 15.9 6.3M8.1 13.3l7.8 4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Local to this page, same convention as ShareIcon above — one-off icons
// that don't appear anywhere else stay local instead of living in
// ui/icons.jsx (see that file's own header comment).
function ZoomIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M11 8v6M8 11h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
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

// Descriptions longer than this get clamped with a "Read more" toggle.
const DESCRIPTION_PREVIEW_LENGTH = 180;

const PROMISE_ITEMS = [
  {
    icon: ShieldCheck,
    title: '12 Point Quality Check',
    description: 'Before delivery, we conduct a 12-point quality check to ensure your order meets our quality standard.',
  },
  {
    icon: IndianRupee,
    title: 'Lowest Price Guarantee',
    description: 'We provide lowest price guarantee so you can rent with confidence. No more searching here and there.',
  },
  {
    icon: Headset,
    title: 'Prompt Help & Support',
    description: 'Fast and efficient support, right at your fingertips. We are available from 10 am to 10 pm everyday.',
  },
];

const BENEFIT_ITEMS = [
  {
    icon: PackageCheck,
    title: 'Top-Quality Products',
    description: 'Always maintained & ready for your next shoot.',
  },
  {
    icon: BadgePercent,
    title: 'Affordable Rates',
    description: 'Save big compared to buying.',
  },
  {
    icon: Leaf,
    title: 'Eco-Friendly',
    description: 'Reduce single-use products.',
  },
];

export default function CameraDetailsPage() {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { requireAuth } = useAuthGate();
  const { items, addItem, showToast, openCart } = useCart();
  const { ids: wishlist, toggle: toggleWishlistId } = useWishlist();

  // Rental dates are picked once in the navbar date picker (shared via
  // useRentalRange). Reading them from there — instead of the URL — means
  // changing the dates up top instantly re-checks availability here and
  // carries straight into the booking form.
  const { range, hasPicked } = useRentalRange();
  const { start, end } = range;

  const [camera, setCamera] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [remaining, setRemaining] = useState(null); // null = not checked yet
  const [checking, setChecking] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [similar, setSimilar] = useState([]);
  const similarListRef = useRef(null);
  const [reviews, setReviews] = useState([]);
  const [descExpanded, setDescExpanded] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(null); // 'exchange' | 'damage' | null
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadCamera() {
      const { data, error: fetchError } = await supabase
        .from('cameras')
        .select('id, name, model, description, features, image_url, photos, stock_quantity, price, status')
        .eq('id', cameraId)
        .single();
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else setCamera(data);
      setLoading(false);
    }
    loadCamera();
    return () => {
      cancelled = true;
    };
  }, [cameraId]);

  // A fresh camera load may have fewer photos than whatever index was
  // active before (or none at all) — reset to the cover photo each time.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePhoto(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDescExpanded(false);
  }, [cameraId]);

  // Same Escape-to-close as CartDrawer/SearchDrawer.
  useEffect(() => {
    if (!zoomOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') setZoomOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomOpen]);

  // Recheck free units whenever the camera or the picked range changes.
  useEffect(() => {
    if (!camera || camera.status !== 'active') return undefined;
    let cancelled = false;
    async function checkRemaining() {
      try {
        const units = await getRemainingUnits(camera, start, end);
        if (!cancelled) setRemaining(units);
      } catch {
        if (!cancelled) setRemaining(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    setChecking(true);
    setRemaining(null);
    checkRemaining();
    return () => {
      cancelled = true;
    };
  }, [camera, start, end]);

  // "Similar products" strip — other active cameras with free units for the
  // same dates. Reuses fetchActiveCameras() (the same base catalogue query
  // SearchDrawer uses) plus the bulk booked-quantity RPC RecommendationsDrawer
  // already relies on, instead of re-implementing either lookup.
  useEffect(() => {
    if (!camera || !start || !end) return undefined;
    let cancelled = false;
    async function loadSimilar() {
      try {
        const [cams, bookedQuantities] = await Promise.all([
          fetchActiveCameras(),
          getBookedQuantitiesByCamera(start, end),
        ]);
        if (cancelled) return;
        const available = cams
          .filter((c) => c.id !== camera.id)
          .map((c) => {
            const stock = c.stock_quantity ?? 0;
            const unitsAvailable = Math.max(0, stock - (bookedQuantities[c.id] ?? 0));
            return { ...c, unitsAvailable };
          })
          .filter((c) => c.unitsAvailable > 0);
        setSimilar(available);
      } catch {
        if (!cancelled) setSimilar([]);
      }
    }
    loadSimilar();
    return () => {
      cancelled = true;
    };
  }, [camera, start, end]);

  // Customer reviews for this camera — public read, so this runs for
  // anon visitors too, same as the availability check above.
  useEffect(() => {
    if (!cameraId) return undefined;
    let cancelled = false;
    async function loadReviews() {
      try {
        const data = await fetchReviewsForCamera(cameraId);
        if (!cancelled) setReviews(data);
      } catch {
        if (!cancelled) setReviews([]);
      }
    }
    loadReviews();
    return () => {
      cancelled = true;
    };
  }, [cameraId]);

  function scrollSimilar(direction) {
    similarListRef.current?.scrollBy({ left: direction * 300, behavior: 'smooth' });
  }

  function handleBookNow() {
    if (!requireAuth(location.pathname + location.search)) return;
    setTermsOpen(true);
  }

  function handleConfirmTerms() {
    setTermsOpen(false);
    navigate(`/book/${cameraId}`, { state: { camera, quantity: 1 } });
  }

  function handleAddToCart() {
    if (!requireAuth(location.pathname + location.search)) return;
    // Same gate as the catalogue's "+" — a real date pick is required
    // before anything goes into the cart, not the today/tomorrow default.
    if (!hasPicked) {
      showToast('warning', 'Please select your rental dates first');
      return;
    }
    addItem(camera, { start, end }, 1);
    if (remaining === 1) showToast('warning', 'Maximum limit reached');
  }

  // Shared by the main wishlist heart and each "Similar products" card's own
  // heart — same gate, same copy, just a different target id.
  function toggleWishlistFor(id) {
    if (
      !requireAuth(location.pathname + location.search, {
        title: 'Login required to save to wishlist',
        message: 'Please log in or create an account to save cameras to your wishlist.',
      })
    ) {
      return;
    }
    toggleWishlistId(id);
  }

  function toggleWishlist() {
    toggleWishlistFor(camera.id);
  }

  function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: camera?.name, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  if (loading) return <Loading label="Loading camera…" />;
  if (error) return <p role="alert">Couldn't load camera: {error}</p>;
  if (!camera) return <p role="alert">Camera not found.</p>;

  const photos = getCameraPhotos(camera);
  const photo = photos[activePhoto] ?? photos[0] ?? null;
  const retired = camera.status !== 'active';
  const soldOut = remaining !== null && remaining <= 0;
  const cartQuantity = items.find((i) => i.camera.id === camera.id)?.quantity ?? 0;
  const wishlisted = wishlist.has(camera.id);
  // Derived from the same dates already picked in the navbar — not a
  // separate/new concept, just another way of showing what's already there.
  const rentalDuration = rentalDays(start, end);
  const avgRating =
    reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
  // Admin-entered, one feature per line (AddCameraForm.jsx) — real per-camera
  // data, not a generic fabricated list.
  const featureList = (camera.features ?? '')
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  const isLongDescription = (camera.description?.length ?? 0) > DESCRIPTION_PREVIEW_LENGTH;

  return (
    <div className="camera-details">
      {/* A real SVG chevron, not the "←" glyph — that character renders
          hairline-thin in this font regardless of font-weight/size, so it
          never actually looked bold or big no matter how it was styled. */}
      <Link to="/" className="camera-details-back" aria-label="Back to all cameras">
        <ChevronLeft size={26} strokeWidth={3} />
      </Link>

      <div className="camera-details-grid">
        <div className="camera-details-media-col">
        <div className="camera-details-media-panel">
          <button
            type="button"
            className={wishlisted ? 'camera-details-wishlist is-wishlisted' : 'camera-details-wishlist'}
            onClick={toggleWishlist}
            aria-label={wishlisted ? `Remove ${camera.name} from wishlist` : `Add ${camera.name} to wishlist`}
          >
            <HeartIcon filled={wishlisted} size={16} />
          </button>
          <button
            type="button"
            className="camera-details-share"
            onClick={handleShare}
            aria-label="Share this camera"
          >
            <ShareIcon />
          </button>
          {photo && (
            <button
              type="button"
              className="camera-details-zoom"
              onClick={() => setZoomOpen(true)}
              aria-label="Zoom into photo"
            >
              <ZoomIcon />
            </button>
          )}
          {linkCopied && <span className="camera-details-copied">Link copied!</span>}

          <div className="camera-details-media-body">
            <div className="camera-details-media">
              {photo ? (
                <>
                  <img
                    key={activePhoto}
                    src={photo}
                    alt={`${camera.name} (${camera.model})`}
                    className="camera-details-media-img"
                    role="button"
                    tabIndex={0}
                    onClick={() => setZoomOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setZoomOpen(true);
                    }}
                  />
                  {photos.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="camera-details-nav camera-details-nav-prev"
                        onClick={() => setActivePhoto((i) => (i - 1 + photos.length) % photos.length)}
                        aria-label="Previous photo"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        type="button"
                        className="camera-details-nav camera-details-nav-next"
                        onClick={() => setActivePhoto((i) => (i + 1) % photos.length)}
                        aria-label="Next photo"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <PhotoPlaceholder size={48} className="camera-details-media-placeholder" />
              )}
            </div>

            {photos.length > 1 && (
              <div className="camera-details-thumbs">
                {photos.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    className={i === activePhoto ? 'camera-details-thumb is-active' : 'camera-details-thumb'}
                    onClick={() => setActivePhoto(i)}
                    aria-label={`Show photo ${i + 1} of ${photos.length}`}
                    aria-current={i === activePhoto}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {photos.length > 1 && (
            <span className="camera-details-media-counter">
              {activePhoto + 1} of {photos.length} Images
            </span>
          )}
        </div>

        <section className="camera-details-reviews">
          <div className="camera-details-reviews-head">
            <h2>Customer Reviews</h2>
            {reviews.length > 0 && (
              <div className="camera-details-reviews-summary">
                <StarRating value={avgRating} size={16} />
                <span>
                  {avgRating.toFixed(1)} out of 5 · {reviews.length} review{reviews.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {reviews.length === 0 ? (
            <p className="camera-details-reviews-empty">
              No reviews yet — be the first to review this camera after your rental.
            </p>
          ) : (
            <ul className="camera-details-reviews-list">
              {reviews.map((r) => (
                <li key={r.id} className="camera-details-review-card">
                  <div className="camera-details-review-head">
                    <StarRating value={r.rating} size={14} />
                    <span className="camera-details-review-date">
                      {new Date(r.created_at).toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  {r.comment && <p className="camera-details-review-comment">{r.comment}</p>}
                  <span className="camera-details-review-name">{r.customer_name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>

        <div className="camera-details-info">
          {retired ? (
            <span className="badge booked camera-details-status">Not currently available</span>
          ) : !hasPicked ? null : checking ? (
            // Nothing shown at all until the customer actually picks
            // dates in the navbar — the today→tomorrow default still
            // drives the underlying availability check (so Book Now/Add
            // to Cart stay correctly enabled or disabled), it's just not
            // surfaced as a claim about "availability" the customer never
            // asked about.
            <span className="hint camera-details-status">Checking availability…</span>
          ) : remaining === null ? (
            <span className="hint camera-details-status">
              Availability unavailable — try again shortly.
            </span>
          ) : soldOut ? (
            <span className="badge booked camera-details-status">Fully booked for these dates</span>
          ) : (
            <span className="badge available camera-details-status">
              {remaining} available for these dates
            </span>
          )}

          <h1>{camera.name}</h1>
          <p className="camera-details-model">{camera.model}</p>
          {camera.description && (
            <div className="camera-details-blurb-wrap">
              <p className={isLongDescription && !descExpanded ? 'camera-details-blurb is-clamped' : 'camera-details-blurb'}>
                {camera.description}
              </p>
              {isLongDescription && (
                <button
                  type="button"
                  className="camera-details-blurb-toggle"
                  onClick={() => setDescExpanded((v) => !v)}
                >
                  {descExpanded ? 'Read less' : 'Read more'}
                </button>
              )}
            </div>
          )}

          {featureList.length > 0 && (
            <div className="camera-details-features">
              <h3>Product Features</h3>
              <ul>
                {featureList.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="camera-details-policies">
            <button type="button" className="camera-details-policy-pill" onClick={() => setPolicyOpen('exchange')}>
              <FileText size={16} />
              Exchange Policy
            </button>
            <button type="button" className="camera-details-policy-pill" onClick={() => setPolicyOpen('damage')}>
              <FileText size={16} />
              Damage Policy
            </button>
          </div>
          {rentalDuration && (
            <p className="camera-details-duration">
              Rent for <strong>{rentalDuration} day{rentalDuration !== 1 ? 's' : ''}</strong>
            </p>
          )}
          {camera.price > 0 && (
            <div className="camera-details-price-block">
              <span className="camera-details-price">{formatPrice(camera.price)}</span>
              <span className="camera-details-price-unit">/ day</span>
              <span className="camera-details-price-note">Price incl. of all taxes</span>
            </div>
          )}
          <div className="camera-details-actions">
            <button
              type="button"
              className="camera-details-book"
              onClick={handleBookNow}
              disabled={retired || soldOut}
              title={soldOut ? STOCK_UNAVAILABLE_MESSAGE : undefined}
            >
              <CalendarIcon />
              <span>Book Now</span>
              <ArrowIcon />
            </button>
            {cartQuantity > 0 ? (
              <button
                type="button"
                className="camera-details-cart"
                onClick={openCart}
              >
                <CartIcon />
                Added to cart ({cartQuantity})
              </button>
            ) : (
              <button
                type="button"
                className="camera-details-cart"
                onClick={handleAddToCart}
                disabled={retired || soldOut}
                title={soldOut ? STOCK_UNAVAILABLE_MESSAGE : undefined}
              >
                <CartIcon />
                Add to Cart
              </button>
            )}
          </div>
        </div>
      </div>

      {similar.length > 0 && (
        <section className="camera-details-similar">
          <div className="camera-details-similar-head">
            <h2>Similar Products</h2>
            <div className="camera-details-similar-nav">
              <button
                type="button"
                className="camera-details-similar-arrow"
                onClick={() => scrollSimilar(-1)}
                aria-label="Scroll similar products left"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="camera-details-similar-arrow"
                onClick={() => scrollSimilar(1)}
                aria-label="Scroll similar products right"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="camera-details-similar-list" ref={similarListRef}>
            {similar.map((c) => {
              const simPhoto = getCameraPhotoUrl(c);
              const simWishlisted = wishlist.has(c.id);
              return (
                <div
                  key={c.id}
                  className="camera-details-similar-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/camera/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') navigate(`/camera/${c.id}`);
                  }}
                >
                  <div className="camera-details-similar-media">
                    {simPhoto ? (
                      <img src={simPhoto} alt={c.name} />
                    ) : (
                      <PhotoPlaceholder size={28} />
                    )}
                    <button
                      type="button"
                      className={
                        simWishlisted
                          ? 'camera-details-similar-heart is-wishlisted'
                          : 'camera-details-similar-heart'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWishlistFor(c.id);
                      }}
                      aria-label={simWishlisted ? `Remove ${c.name} from wishlist` : `Add ${c.name} to wishlist`}
                    >
                      <HeartIcon filled={simWishlisted} size={14} />
                    </button>
                  </div>
                  <div className="camera-details-similar-body">
                    <span className="camera-details-similar-name">{c.name}</span>
                    <span className="camera-details-similar-model">{c.model}</span>
                    {rentalDuration > 0 && (
                      <span className="camera-details-similar-days">
                        Rent for {rentalDuration} day{rentalDuration !== 1 ? 's' : ''}
                      </span>
                    )}
                    {c.price > 0 && (
                      <span className="camera-details-similar-price">
                        {formatPrice(c.price)}
                        <span className="camera-details-similar-price-unit">/day</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="camera-promise">
        <div className="camera-promise-header">
          <span className="camera-promise-header-icon">
            <ShieldCheck size={26} />
          </span>
          <div className="camera-promise-header-text">
            <span className="camera-promise-brand">DreamCapture Promise</span>
            <span className="camera-promise-tagline">Rent with peace of mind</span>
          </div>
        </div>
        <div className="camera-promise-grid">
          {PROMISE_ITEMS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="camera-promise-item">
              <span className="camera-promise-item-icon">
                <Icon size={24} />
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="camera-benefits">
        <h2>Key Benefits of Renting?</h2>
        <div className="camera-benefits-grid">
          {BENEFIT_ITEMS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="camera-benefit-card">
              <span className="camera-benefit-icon">
                <Icon size={26} />
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      {termsOpen && (
        <TermsGateModal
          title={`Before you reserve ${camera.name}`}
          continueLabel="Continue to Reserve"
          onAgree={handleConfirmTerms}
          onClose={() => setTermsOpen(false)}
        />
      )}

      <PolicyDrawer policyKey={policyOpen} onClose={() => setPolicyOpen(null)} />

      {zoomOpen && photo && (
        <>
          <div className="camera-zoom-backdrop" onClick={() => setZoomOpen(false)} />
          <aside className="camera-zoom-drawer" role="dialog" aria-modal="true" aria-label="Product images">
            <div className="camera-zoom-header">
              <CloseButton className="camera-zoom-close" label="Close" onClick={() => setZoomOpen(false)} />
              <h2>Product Images</h2>
            </div>

            <div className="camera-zoom-body">
              {photos.length > 1 && (
                <button
                  type="button"
                  className="camera-zoom-nav camera-zoom-nav-prev"
                  onClick={() => setActivePhoto((i) => (i - 1 + photos.length) % photos.length)}
                  aria-label="Previous photo"
                >
                  <ChevronLeft size={20} />
                </button>
              )}

              <img src={photo} alt={`${camera.name} (${camera.model})`} />

              {photos.length > 1 && (
                <button
                  type="button"
                  className="camera-zoom-nav camera-zoom-nav-next"
                  onClick={() => setActivePhoto((i) => (i + 1) % photos.length)}
                  aria-label="Next photo"
                >
                  <ChevronRight size={20} />
                </button>
              )}
            </div>

            {photos.length > 1 && (
              <span className="camera-zoom-counter">
                {activePhoto + 1} of {photos.length} Images
              </span>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
