import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useCart } from '../lib/useCart';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import { getBookedQuantitiesByCamera } from '../lib/availability';
import { formatPrice } from '../lib/common';
import { formatDate } from '../lib/dateUtils';
import { CalendarIcon, CheckIcon, InfoIcon, ArrowIcon } from './ui/icons';
import CloseButton from './ui/CloseButton';
import './RecommendationsDrawer.css';

// Opens when a product-card "+" is blocked because the item is already at
// its max available quantity. Shows the maxed-out item plus other in-stock
// cameras for the same dates, since the user can't add more of that one —
// this replaces the plain "open the cart" behavior for that specific case.
export default function RecommendationsDrawer() {
  const {
    maxQuantityContext,
    closeMaxQuantityDrawer,
    maxQuantityToast,
    dismissMaxQuantityToast,
    addItem,
    openCart,
  } = useCart();

  const [suggestions, setSuggestions] = useState([]);
  const [justAddedIds, setJustAddedIds] = useState(() => new Set());

  const camera = maxQuantityContext?.camera ?? null;
  const dates = maxQuantityContext?.dates ?? null;

  useEffect(() => {
    if (!maxQuantityContext) return;
    let cancelled = false;

    async function loadSuggestions() {
      if (!dates?.start || !dates?.end) {
        setSuggestions([]);
        return;
      }
      try {
        const [{ data: cams, error: camError }, bookedQuantities] = await Promise.all([
          supabase
            .from('cameras')
            .select('id, name, model, status, image_url, stock_quantity, price')
            .eq('status', 'active')
            .neq('id', camera.id)
            .order('name'),
          getBookedQuantitiesByCamera(dates.start, dates.end),
        ]);
        if (camError) throw camError;
        if (cancelled) return;

        const available = cams
          .map((c) => {
            const stock = c.stock_quantity ?? 0;
            const unitsAvailable = Math.max(0, stock - (bookedQuantities[c.id] ?? 0));
            return { ...c, unitsAvailable };
          })
          .filter((c) => c.unitsAvailable > 0);
        setSuggestions(available);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }

    loadSuggestions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxQuantityContext]);

  useEffect(() => {
    if (!maxQuantityContext) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') closeMaxQuantityDrawer();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxQuantityContext]);

  if (!maxQuantityContext) return null;

  function handleAddSuggestion(suggested) {
    addItem(suggested, dates, 1);
    setJustAddedIds((prev) => new Set(prev).add(suggested.id));
    setTimeout(() => {
      setJustAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(suggested.id);
        return next;
      });
    }, 2000);
  }

  // "Continue to Cart" hands off to the cart-contents drawer rather than
  // navigating away — stays in the drawer flow instead of leaving the page.
  function handleContinueToCart() {
    closeMaxQuantityDrawer();
    openCart();
  }

  return (
    <>
      <div className="reco-drawer-backdrop" onClick={closeMaxQuantityDrawer} />
      <aside className="reco-drawer" role="dialog" aria-modal="true" aria-label="Item at max quantity">
        <div className="reco-drawer-header">
          <CloseButton className="reco-drawer-close" label="Close" onClick={closeMaxQuantityDrawer} />
          <h2>Item at Max Quantity</h2>
        </div>

        {maxQuantityToast && (
          <div className="reco-drawer-toast" role="status">
            <span className="reco-drawer-toast-icon">
              <InfoIcon />
            </span>
            <span className="reco-drawer-toast-text">{maxQuantityToast.message}</span>
            <CloseButton
              className="reco-drawer-toast-close"
              label="Dismiss"
              onClick={dismissMaxQuantityToast}
            />
          </div>
        )}

        <div className="reco-drawer-body">
          {camera && (
            <div className="reco-highlight-card">
              {getCameraPhotoUrl(camera) ? (
                <img src={getCameraPhotoUrl(camera)} alt={camera.name} />
              ) : (
                <div className="reco-highlight-thumb-empty" />
              )}
              <div className="reco-highlight-info">
                <span className="reco-highlight-name">{camera.name}</span>
                <span className="reco-highlight-desc">{camera.model}</span>
                {camera.price > 0 && (
                  <span className="reco-highlight-price">{formatPrice(camera.price)}/day</span>
                )}
                <span className="reco-highlight-badge">
                  <CheckIcon size={14} /> Max quantity reached
                </span>
              </div>
            </div>
          )}

          {suggestions.length > 0 && (
            <>
              <h3 className="reco-section-title">You may also like</h3>
              <ul className="reco-list">
                {suggestions.map((item) => {
                  const photo = getCameraPhotoUrl(item);
                  const justAdded = justAddedIds.has(item.id);
                  return (
                    <li key={item.id} className="reco-row">
                      {photo ? (
                        <img src={photo} alt={item.name} />
                      ) : (
                        <div className="reco-row-thumb-empty" />
                      )}
                      <div className="reco-row-info">
                        <span className="reco-row-name">{item.name}</span>
                        <span className="reco-row-desc">{item.model}</span>
                        {item.price > 0 && (
                          <span className="reco-row-price">{formatPrice(item.price)}/day</span>
                        )}
                      </div>
                      {justAdded ? (
                        <span className="reco-row-added">
                          <CheckIcon size={14} /> Added
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="reco-row-add-btn"
                          onClick={() => handleAddSuggestion(item)}
                        >
                          + Add
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div className="reco-drawer-footer">
          <div className="reco-drawer-dates">
            <span className="reco-drawer-date-field">
              <CalendarIcon />
              Delivery Date: <strong>{formatDate(dates?.start) || '—'}</strong>
            </span>
            <span className="reco-drawer-date-divider" aria-hidden="true" />
            <span className="reco-drawer-date-field">
              <CalendarIcon />
              Pickup Date: <strong>{formatDate(dates?.end) || '—'}</strong>
            </span>
          </div>
          <button type="button" className="reco-continue-btn" onClick={handleContinueToCart}>
            Continue to Cart
            <ArrowIcon />
          </button>
        </div>
      </aside>
    </>
  );
}
