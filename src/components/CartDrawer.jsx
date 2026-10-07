import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../lib/useCart';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import { getRemainingUnits } from '../lib/availability';
import { formatPrice } from '../lib/common';
import { rentalDays } from '../lib/rentalDays';
import { InfoIcon } from './ui/icons';
import CloseButton from './ui/CloseButton';
import QuantityStepper from './QuantityStepper';
import './CartDrawer.css';

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"
      />
    </svg>
  );
}

// Quick-access slide-in mini-cart, opened from the navbar cart icon or the
// "Go to Cart" FAB. It's a fast overview + quantity control; per-item
// rental-date editing and final checkout (name/location/phone + submit)
// still happen on the full /cart page — "Edit" and "Continue" both route there.
export default function CartDrawer() {
  const {
    items,
    removedCameraIds,
    isCartOpen,
    closeCart,
    updateQuantity,
    removeItem,
    maxQuantityToast,
    showMaxQuantityToast,
    dismissMaxQuantityToast,
  } = useCart();
  const navigate = useNavigate();

  const [availability, setAvailability] = useState({}); // { [cameraId]: remainingUnits }

  const availabilityKey = items
    .map((item) => `${item.camera.id}|${item.startDate}|${item.endDate}`)
    .join(',');

  useEffect(() => {
    if (!isCartOpen) return;
    let cancelled = false;

    async function refresh() {
      const entries = await Promise.all(
        items.map(async (item) => {
          if (!item.startDate || !item.endDate) return [item.camera.id, null];
          try {
            const remaining = await getRemainingUnits(item.camera, item.startDate, item.endDate);
            return [item.camera.id, remaining];
          } catch {
            return [item.camera.id, null];
          }
        })
      );
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    }

    refresh();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCartOpen, availabilityKey]);

  useEffect(() => {
    if (!maxQuantityToast) return;
    const timer = setTimeout(dismissMaxQuantityToast, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxQuantityToast]);

  useEffect(() => {
    if (!isCartOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') closeCart();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCartOpen]);

  if (!isCartOpen) return null;

  function handleIncrement(item) {
    const available = availability[item.camera.id];
    if (available == null) return; // still loading — disabled stepper covers this too
    if (item.quantity < available) {
      updateQuantity(item.camera.id, item.quantity + 1);
    } else {
      showMaxQuantityToast(`Max quantity of ${available} reached for this item.`);
    }
  }

  function handleDecrement(item) {
    if (item.quantity <= 1) {
      removeItem(item.camera.id);
    } else {
      updateQuantity(item.camera.id, item.quantity - 1);
    }
  }

  function goToFullCart() {
    closeCart();
    navigate('/cart');
  }

  // Removed-by-admin items don't count toward the total — they can't
  // actually be booked, so charging for them would be misleading.
  const availableItems = items.filter((item) => !removedCameraIds.has(item.camera.id));
  const grandTotal = availableItems.reduce((sum, item) => {
    const days = rentalDays(item.startDate, item.endDate) ?? 1;
    return sum + item.quantity * (item.camera.price ?? 0) * days;
  }, 0);

  return (
    <>
      <div className="cart-drawer-backdrop" onClick={closeCart} />
      <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Cart">
        <div className="cart-drawer-header">
          <CloseButton className="cart-drawer-close" label="Close cart" onClick={closeCart} />
          <h2>Cart Items</h2>
          <span className="cart-drawer-count">
            {availableItems.length} item{availableItems.length !== 1 ? 's' : ''} added
          </span>
        </div>

        {maxQuantityToast && (
          <div className="cart-drawer-toast" role="status">
            <span className="cart-drawer-toast-icon">
              <InfoIcon />
            </span>
            <span className="cart-drawer-toast-text">{maxQuantityToast.message}</span>
            <CloseButton
              className="cart-drawer-toast-close"
              label="Dismiss"
              onClick={dismissMaxQuantityToast}
            />
          </div>
        )}

        {items.length === 0 ? (
          <div className="cart-drawer-empty">
            <p>Your cart is empty.</p>
          </div>
        ) : (
          <>
            <ul className="cart-drawer-list">
              {items.map((item) => {
                const photo = getCameraPhotoUrl(item.camera);
                const days = rentalDays(item.startDate, item.endDate);
                const price = item.camera.price ?? 0;
                const available = availability[item.camera.id];
                const isRemoved = removedCameraIds.has(item.camera.id);
                return (
                  <li key={item.camera.id} className={isRemoved ? 'cart-drawer-row is-removed' : 'cart-drawer-row'}>
                    {photo ? (
                      <img src={photo} alt={item.camera.name} />
                    ) : (
                      <div className="cart-drawer-thumb-empty" />
                    )}

                    <div className="cart-drawer-row-main">
                      <span className="cart-drawer-row-name">{item.camera.name}</span>
                      <span className="cart-drawer-row-category">{item.camera.model}</span>

                      {isRemoved ? (
                        <div className="cart-drawer-row-controls">
                          <span className="cart-drawer-unavailable">No longer available</span>
                          <button
                            type="button"
                            className="cart-drawer-delete"
                            aria-label={`Remove ${item.camera.name} from cart`}
                            onClick={() => removeItem(item.camera.id)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      ) : (
                        <div className="cart-drawer-row-controls">
                          <QuantityStepper
                            quantity={item.quantity}
                            available={available ?? item.quantity}
                            onIncrement={() => handleIncrement(item)}
                            onDecrement={() => handleDecrement(item)}
                            min={0}
                          />
                          <button
                            type="button"
                            className="cart-drawer-delete"
                            aria-label={`Remove ${item.camera.name} from cart`}
                            onClick={() => removeItem(item.camera.id)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      )}
                    </div>

                    {!isRemoved && (
                      <div className="cart-drawer-row-price">
                        <span className="cart-drawer-row-total">{formatPrice(price * item.quantity * (days ?? 1))}</span>
                        {days && (
                          <span className="cart-drawer-row-days">
                            Rent for {days} day{days !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="cart-drawer-footer">
              <div className="cart-drawer-total-label">
                <span>Total Charges</span>
                <span className="cart-drawer-total-subtext">Price incl. of all taxes</span>
              </div>
              <div className="cart-drawer-footer-bottom">
                <span className="cart-drawer-total-amount">{formatPrice(grandTotal)}</span>
                <button type="button" className="cart-drawer-pay-btn" onClick={goToFullCart}>
                  Continue
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
