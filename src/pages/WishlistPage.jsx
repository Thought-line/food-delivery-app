import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/useAuth';
import { useWishlist } from '../lib/useWishlist';
import { fetchWishlistCameras } from '../lib/wishlist';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import { formatPrice } from '../lib/common';
import PhotoPlaceholder from '../components/ui/PhotoPlaceholder';
import Loading from '../components/ui/Loading';
// .camera-status-pill / .camera-thumb-placeholder are the catalogue grid's
// own styles, reused here rather than duplicated. Everything else on this
// page (header, cards) is unique to it, in WishlistPage.css.
import '../components/CameraList.css';
import './WishlistPage.css';

// One-off icon, only used here — see icons.jsx's own comment on why icons
// used in a single place stay local instead of joining that shared file
// (CartFeedback.jsx's CartIcon follows the same rule).
function TrashIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M9 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"
      />
    </svg>
  );
}

export default function WishlistPage() {
  const { user } = useAuth(); // the currently logged-in customer (route is customer-protected)
  const { remove } = useWishlist();
  const navigate = useNavigate();
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    function loadWishlist() {
      fetchWishlistCameras(user.id)
        .then((data) => {
          if (!cancelled) setCameras(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    setLoading(true);
    setError(null);
    loadWishlist();

    // Live updates — an admin retiring/restoring a camera (or changing its
    // price/photo) while this page is already open shouldn't need a manual
    // refresh to show up here. Same "listen to all camera changes, just
    // reload" pattern CartContext's own cart-camera-changes channel uses.
    const channel = supabase
      .channel('wishlist-camera-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => loadWishlist())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  function handleRemove(camera) {
    // Optimistic update of this page's own camera list, reverted on failure.
    // useWishlist().remove already handles the shared id set + toast (same
    // "could not update" pattern CameraList's heart uses) and rejects on
    // failure so this can revert its own list too, without a second toast.
    setCameras((prev) => prev.filter((c) => c.id !== camera.id));
    remove(camera.id).catch(() => {
      setCameras((prev) => [...prev, camera]);
    });
  }

  return (
    <div className="wishlist-page">
      <div className="wishlist-page-header">
        <h2>My Wishlist{cameras.length > 0 ? ` (${cameras.length})` : ''}</h2>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <Loading />}

      {!loading && cameras.length === 0 && (
        <p className="wishlist-empty">You haven't saved any cameras yet. Tap the heart on a camera to save it here.</p>
      )}

      {!loading && cameras.length > 0 && (
        <ul className="wishlist-card-list">
          {cameras.map((camera) => {
            const photo = getCameraPhotoUrl(camera);
            return (
              <li key={camera.id} className="wishlist-card">
                {/* Thumbnail + name/price open the details page; the trash
                    button (a sibling, not nested inside) removes it from the
                    wishlist — no stopPropagation needed since it's not
                    inside the clickable area. */}
                <div
                  className="wishlist-card-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/camera/${camera.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') navigate(`/camera/${camera.id}`);
                  }}
                >
                  <div className="wishlist-card-thumb">
                    {photo ? (
                      <img src={photo} alt={`${camera.name} (${camera.model})`} loading="lazy" />
                    ) : (
                      <PhotoPlaceholder size={28} className="camera-thumb-placeholder" />
                    )}
                  </div>

                  <div className="wishlist-card-info">
                    <span className="wishlist-card-name">{camera.name}</span>
                    {camera.price > 0 && (
                      <span className="wishlist-card-price">
                        {formatPrice(camera.price)}
                        <span className="price-unit">/day</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Stacked in the card's right edge — badge on top, trash
                    button below it. */}
                <span className={camera.status === 'active' ? 'camera-status-pill wishlist-card-badge' : 'camera-status-pill is-off wishlist-card-badge'}>
                  {camera.status === 'active' ? 'Available' : 'Unavailable'}
                </span>

                <button
                  type="button"
                  className="wishlist-card-remove"
                  aria-label={`Remove ${camera.name} from wishlist`}
                  onClick={() => handleRemove(camera)}
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
