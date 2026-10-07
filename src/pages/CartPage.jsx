import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useCart } from '../lib/useCart';
import { useAuthGate } from '../lib/useAuthGate';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import {
  getRemainingUnits,
  getCameraDailyAvailability,
  quantityAwareDayStatus,
  findShortDates,
  formatShortDatesMessage,
  STOCK_UNAVAILABLE_MESSAGE,
} from '../lib/availability';
import { formatPrice } from '../lib/common';
import { advanceEstimate, createBookingOrder, openRazorpayCheckout } from '../lib/payments';
import { toISODate, isoToLocalDate, todayISO, addDaysISO } from '../lib/dateUtils';
import { getNameError, getPhoneError, getLocationError } from '../lib/contactValidation';
import { useProfileContactDefaults } from '../lib/useProfileContactDefaults';
import { rentalDays } from '../lib/rentalDays';
import QuantityStepper from '../components/QuantityStepper';
import DateRangePicker from '../components/DateRangePicker';
import ContactFields from '../components/ContactFields';
import PaymentOptions from '../components/PaymentOptions';
import TermsGateModal from '../components/TermsGateModal';
import MessagePopup from '../components/ui/MessagePopup';
import './CartPage.css';

export default function CartPage() {
  const { items, removedCameraIds, updateQuantity, updateDates, removeItem, clearCart, showToast } = useCart();
  const { requireAuth } = useAuthGate();
  const navigate = useNavigate();

  // How many units are actually available for each cart item's own dates —
  // { [cameraId]: remainingUnits }. Refreshed whenever the set of cameras
  // or any of their dates change (not on every quantity click).
  const [availability, setAvailability] = useState({});
  // { [cameraId]: message } — names the actual short dates when a "+" click
  // is blocked, so the reason stays visible instead of just a toast that
  // auto-dismisses. Reset whenever any item's camera/dates change (see the
  // availabilityKey effect below), since a stale reason for an old date
  // pick would be misleading once the dates move.
  const [quantityWarnings, setQuantityWarnings] = useState({});

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  useProfileContactDefaults({ setName, setPhone, setLocation });
  const [paymentOption, setPaymentOption] = useState('full'); // 'full' | 'advance'
  const [fieldErrors, setFieldErrors] = useState({}); // errors shown under each contact field
  const [checkingAvailability, setCheckingAvailability] = useState(false); // pre-submit stock re-check, before the terms gate
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(null); // heading for the error popup; null = generic default
  const [termsOpen, setTermsOpen] = useState(false);

  // Sets the error popup's message + heading together so they never drift
  // out of sync (e.g. a later generic error showing a stale custom title).
  function showError(message, title = null) {
    setErrorTitle(title);
    setError(message);
  }

  const availabilityKey = items
    .map((item) => `${item.camera.id}|${item.startDate}|${item.endDate}`)
    .join(',');

  // Bumped on any bookings-table change anywhere (someone else's booking,
  // or an admin cancelling one) so the availability re-check below re-runs
  // live — otherwise a stale "not enough stock" warning only clears on a
  // manual page refresh, since the effect it lives in only reruns when the
  // customer's own cart items/dates change.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const channel = supabase
      .channel('cart-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        setRefreshTick((t) => t + 1);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
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
      if (cancelled) return;
      setAvailability(Object.fromEntries(entries));

      // Clamp down any item whose held quantity now exceeds what's actually
      // free for its dates — dates were edited to a tighter range, or
      // someone else's booking ate the stock, since it was added. Without
      // this the row is stuck showing an impossible "5 of 4 available" with
      // no way to fix it except manually clicking "−" (this effect only
      // reruns on a camera/date change, not on quantity, so it can't
      // re-trigger itself).
      for (const [cameraId, remaining] of entries) {
        if (remaining == null) continue;
        const item = items.find((i) => i.camera.id === cameraId);
        if (!item || item.quantity <= remaining) {
          // Fine now — clear a stale warning left over from before, e.g. an
          // admin freeing up these dates elsewhere (see refreshTick above),
          // rather than leaving it stuck until the customer's own cart
          // items/dates change.
          setQuantityWarnings((prev) => (prev[cameraId] ? { ...prev, [cameraId]: undefined } : prev));
          continue;
        }
        if (remaining > 0) {
          updateQuantity(cameraId, remaining);
          showToast(
            'warning',
            `${item.camera.name} quantity reduced to ${remaining} — that's all that's available for these dates.`
          );
          continue;
        }
        // Zero available — previously this silently removed the item from
        // the cart via updateQuantity(cameraId, 0), with only a toast (which
        // auto-dismisses) explaining why. That loses the customer's
        // selection outright for what might just be a bad date pick. Leave
        // the item and its quantity as they are, and name the actual short
        // dates in a persistent inline message instead — checkout's own
        // pre-submit check (see handleSubmit) still blocks it from actually
        // being booked until the dates are fixed.
        try {
          const shortDates = await findShortDates(item.camera, item.startDate, item.endDate, item.quantity);
          setQuantityWarnings((prev) => ({
            ...prev,
            [cameraId]: formatShortDatesMessage(shortDates) ?? STOCK_UNAVAILABLE_MESSAGE,
          }));
        } catch {
          setQuantityWarnings((prev) => ({ ...prev, [cameraId]: STOCK_UNAVAILABLE_MESSAGE }));
        }
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityKey, refreshTick]);

  // A short-dates reason named for an old date pick would be misleading
  // once the camera/dates actually change — clear it right along with the
  // availability re-check above. NOT reset on refreshTick — a realtime
  // change elsewhere shouldn't blank out an existing warning before the
  // fresh re-check above has a chance to confirm whether it still applies.
  useEffect(() => {
    setQuantityWarnings({});
  }, [availabilityKey]);

  // Booked/available tint + exact-count tooltip for each item's own date
  // picker — same per-day data and 180-day window BookingForm.jsx fetches
  // for the single-camera flow, just one fetch per distinct camera in the
  // cart instead of one. Keyed on which cameras are in the cart (not dates
  // or quantity — those don't need a refetch, only a recolor, see dayStatus
  // below).
  const [dayDataByCamera, setDayDataByCamera] = useState({});
  const cameraIdsKey = [...new Set(items.map((item) => item.camera.id))].join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = cameraIdsKey ? cameraIdsKey.split(',') : [];
    Promise.all(
      ids.map((id) =>
        getCameraDailyAvailability(id, todayISO(), addDaysISO(todayISO(), 180))
          .then((data) => [id, data])
          .catch(() => [id, {}]) // purely decorative — a failed fetch just leaves that camera's days untinted
      )
    ).then((entries) => {
      if (!cancelled) setDayDataByCamera(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [cameraIdsKey]);

  async function handleIncreaseQuantity(item) {
    const available = availability[item.camera.id];
    if (available == null) return; // still loading — the disabled stepper covers this too
    if (item.quantity < available) {
      const newQuantity = item.quantity + 1;
      updateQuantity(item.camera.id, newQuantity);
      setQuantityWarnings((prev) => ({ ...prev, [item.camera.id]: undefined }));
      // Reaching the cap on a successful increase — different from clicking
      // + again afterward, which is blocked entirely (see the else branch).
      if (newQuantity === available) {
        showToast('warning', 'Maximum limit reached');
      }
      return;
    }
    // Already at the stock limit — the toast alone auto-dismisses and never
    // says why, so also name the actual short dates and leave that visible
    // under the stepper until the camera/dates change (see the
    // quantityWarnings reset effect above), same findShortDates/
    // formatShortDatesMessage pair this page already uses at submit time.
    showToast('warning', 'Limited quantity reached');
    try {
      const shortDates = await findShortDates(item.camera, item.startDate, item.endDate, item.quantity + 1);
      setQuantityWarnings((prev) => ({
        ...prev,
        [item.camera.id]: formatShortDatesMessage(shortDates) ?? STOCK_UNAVAILABLE_MESSAGE,
      }));
    } catch {
      setQuantityWarnings((prev) => ({ ...prev, [item.camera.id]: STOCK_UNAVAILABLE_MESSAGE }));
    }
  }

  function handleDecreaseQuantity(item) {
    setQuantityWarnings((prev) => ({ ...prev, [item.camera.id]: undefined }));
    if (item.quantity <= 1) {
      removeItem(item.camera.id); // reaching 0 removes the camera, same as clicking Remove
      return;
    }
    updateQuantity(item.camera.id, item.quantity - 1);
  }

  // Validates the contact form + cart dates, same as before — but instead
  // of submitting straight away, opens the terms gate; the actual request
  // only goes out once that's agreed to (see submitBookings below).
  async function handleSubmit(e) {
    e.preventDefault();
    showError(null);

    // Safety net for an idle auto-logout while the checkout form was open —
    // same prompt as everywhere else instead of a raw "must be signed in" RPC error.
    if (!requireAuth('/cart')) return;

    const errors = {
      name: getNameError(name),
      phone: getPhoneError(phone),
      location: getLocationError(location),
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    // Skip removed cameras — they're skipped in submitBookings too (see the
    // removedCameraIds check there), so their dates don't need to be valid
    // to let the rest of checkout proceed.
    const payable = items.filter((item) => !removedCameraIds.has(item.camera.id));

    for (const item of payable) {
      if (!item.startDate || !item.endDate) {
        showError(`Pick both dates for ${item.camera.name}.`);
        return;
      }
      if (new Date(item.endDate) <= new Date(item.startDate)) {
        showError(`End date must be after the start date for ${item.camera.name}.`);
        return;
      }
    }

    // Fresh per-item stock re-check right before checkout — dates may have
    // looked fine the last time the periodic `availability` poll above ran
    // but been booked by someone else since. Names the specific short dates
    // per camera instead of a flat "not available", same pre-submit check
    // BookingForm.jsx does for the single-camera flow.
    setCheckingAvailability(true);
    const shortages = [];
    await Promise.all(
      payable.map(async (item) => {
        let remaining;
        try {
          remaining = await getRemainingUnits(item.camera, item.startDate, item.endDate);
        } catch {
          return; // best-effort — the server-side hold still enforces this for real on submit
        }
        if (remaining >= item.quantity) return;
        try {
          const shortDates = await findShortDates(item.camera, item.startDate, item.endDate, item.quantity);
          shortages.push(`${item.camera.name}: ${formatShortDatesMessage(shortDates) ?? STOCK_UNAVAILABLE_MESSAGE}`);
        } catch {
          shortages.push(`${item.camera.name}: ${STOCK_UNAVAILABLE_MESSAGE}`);
        }
      })
    );
    setCheckingAvailability(false);
    if (shortages.length > 0) {
      showError(shortages.join(' '));
      return;
    }

    setTermsOpen(true);
  }

  async function submitBookings() {
    setTermsOpen(false);
    setSubmitting(true);
    showError(null);

    const payable = items.filter((item) => !removedCameraIds.has(item.camera.id));
    const nameByCamera = Object.fromEntries(payable.map((item) => [item.camera.id, item.camera.name]));

    // The server creates a 15-minute hold per item (the stock trigger rejects
    // any whose dates are gone → they come back in `failures`), then returns
    // ONE Razorpay order for the combined amount due.
    let order;
    try {
      order = await createBookingOrder({
        items: payable.map((item) => ({
          camera_id: item.camera.id,
          start_date: item.startDate,
          end_date: item.endDate,
          quantity: item.quantity,
        })),
        paymentOption,
        name: name.trim(),
        location: location.trim(),
        phone: phone.trim(),
      });
    } catch (err) {
      setSubmitting(false);
      if (err.code === 'unavailable') {
        const names = (err.failures ?? []).map((f) => nameByCamera[f.camera_id] ?? 'an item').join(', ');
        showError(
          names
            ? `${names}: ${STOCK_UNAVAILABLE_MESSAGE}`
            : STOCK_UNAVAILABLE_MESSAGE
        );
      } else {
        showError(err.message);
      }
      return;
    }

    const heldIds = order.booking_ids ?? [];
    const releaseHolds = () => {
      for (const id of heldIds) {
        supabase.rpc('cancel_unpaid_hold', { p_booking_id: id }).catch(() => {});
      }
    };

    // Items the server couldn't hold — surfaced as a warning, left in the cart.
    const failureNote =
      order.failures && order.failures.length > 0
        ? ` Not booked: ${order.failures
            .map((f) => `${nameByCamera[f.camera_id] ?? 'an item'} (${f.message})`)
            .join('; ')}.`
        : '';

    try {
      await openRazorpayCheckout({
        order,
        description: `Camera rental — ${heldIds.length} item${heldIds.length !== 1 ? 's' : ''}`,
        prefill: { name: name.trim(), contact: phone.trim() },
        onSuccess: () => {
          setSubmitting(false);
          // Only clear the items that were actually held/paid for.
          for (const item of payable) {
            if (!order.failures?.some((f) => f.camera_id === item.camera.id)) {
              removeItem(item.camera.id);
            }
          }
          showToast(
            'success',
            `Booking${heldIds.length > 1 ? 's' : ''} confirmed! Check your email for pickup verification code${heldIds.length > 1 ? 's' : ''}.${failureNote}`
          );
          navigate('/my-bookings');
        },
        onError: (err, info) => {
          setSubmitting(false);
          if (info?.paid) {
            showError('Finalizing your booking. Check My Bookings in a moment.', 'Payment Received');
          } else {
            showError(
              `${err.message || 'The payment did not go through'} — these bookings haven't been confirmed. You can try again.`,
              'Booking Not Confirmed'
            );
            releaseHolds();
          }
        },
        onDismiss: () => {
          setSubmitting(false);
          showError(
            "Your payment wasn't completed, so these bookings haven't been confirmed. You can try again anytime.",
            'Booking Not Confirmed'
          );
          releaseHolds();
        },
      });
    } catch (err) {
      setSubmitting(false);
      showError(err.message || 'Could not open payment. Please try again.');
      releaseHolds();
    }
  }

  // Nothing to show or submit if the cart is empty
  if (items.length === 0) {
    return (
      <div className="cart-page cart-empty">
        <h2>Your cart</h2>
        <p>Your cart is empty.</p>
        <Link to="/" className="link">Browse cameras</Link>
      </div>
    );
  }

  // Cameras an admin has since removed don't count toward the total or the
  // "Place N requests" button — they can't actually be submitted (see
  // submitBookings, which skips them with a clear per-item message).
  const availableItems = items.filter((item) => !removedCameraIds.has(item.camera.id));
  const grandTotal = availableItems.reduce((sum, item) => {
    const days = rentalDays(item.startDate, item.endDate) ?? 1;
    return sum + item.quantity * (item.camera.price ?? 0) * days;
  }, 0);
  const grandAdvance = advanceEstimate(grandTotal);
  const amountDue = paymentOption === 'advance' ? grandAdvance : grandTotal;

  return (
    <div className="cart-page">
      <h2>Your cart</h2>

      <ul className="cart-list">
        {items.map((item) => {
          const photo = getCameraPhotoUrl(item.camera);
          const available = availability[item.camera.id];
          const price = item.camera.price ?? 0;
          const days = rentalDays(item.startDate, item.endDate) ?? 1;
          const isRemoved = removedCameraIds.has(item.camera.id);
          const itemDayData = dayDataByCamera[item.camera.id];
          // Quantity-aware, per this row's own item.quantity — same rule as
          // BookingForm.jsx's dayStatus, just closed over this row instead
          // of a single form's state.
          function dayStatus(iso) {
            const d = itemDayData?.[iso];
            if (!d) return undefined;
            return quantityAwareDayStatus(d.available, item.quantity);
          }
          function dayAvailable(iso) {
            return itemDayData?.[iso]?.available;
          }
          return (
            <li key={item.camera.id} className={isRemoved ? 'cart-row is-removed' : 'cart-row'}>
              {photo ? (
                <img src={photo} alt={item.camera.name} />
              ) : (
                <div className="cart-thumb-empty" />
              )}

              <div className="cart-row-info">
                <span className="cart-row-name">{item.camera.name}</span>
                <span className="cart-row-model">{item.camera.model}</span>
                {!isRemoved && price > 0 && (
                  <span className="cart-row-price">
                    {formatPrice(price)}/day × {item.quantity} × {days} day{days !== 1 ? 's' : ''} ={' '}
                    {formatPrice(price * item.quantity * days)}
                  </span>
                )}
              </div>

              {isRemoved ? (
                <span className="cart-row-unavailable">This camera is no longer available</span>
              ) : (
                <>
                  <div className="cart-row-dates">
                    <DateRangePicker
                      variant="pill"
                      compact
                      editAccent
                      initialStart={item.startDate ? isoToLocalDate(item.startDate) : null}
                      initialEnd={item.endDate ? isoToLocalDate(item.endDate) : null}
                      onChange={(start, end) =>
                        updateDates(item.camera.id, { start: toISODate(start), end: toISODate(end) })
                      }
                      dayStatus={dayStatus}
                      dayAvailable={dayAvailable}
                    />
                    {quantityWarnings[item.camera.id] && (
                      <p className="warning cart-row-quantity-warning">{quantityWarnings[item.camera.id]}</p>
                    )}
                  </div>

                  <div className="cart-row-quantity">
                    <QuantityStepper
                      quantity={item.quantity}
                      available={available ?? item.quantity}
                      onIncrement={() => handleIncreaseQuantity(item)}
                      onDecrement={() => handleDecreaseQuantity(item)}
                      min={0}
                    />
                    <span className="availability-hint">
                      {available == null ? 'Checking availability…' : `${item.quantity} of ${available} available`}
                    </span>
                  </div>
                </>
              )}

              <button
                type="button"
                className="cart-remove-btn"
                onClick={() => removeItem(item.camera.id)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      {grandTotal > 0 && (
        <p className="cart-grand-total">Estimated total: {formatPrice(grandTotal)}</p>
      )}

      <form className="cart-checkout-form" onSubmit={handleSubmit} noValidate>
        <h3>Contact details</h3>

        <ContactFields
          name={name} onNameChange={setName}
          phone={phone} onPhoneChange={setPhone}
          location={location} onLocationChange={setLocation}
          fieldErrors={fieldErrors} setFieldErrors={setFieldErrors}
        />

        <PaymentOptions total={grandTotal} value={paymentOption} onChange={setPaymentOption} />

        <MessagePopup message={error} title={errorTitle ?? undefined} onClose={() => showError(null)} />

        <div className="cart-checkout-actions">
          <button type="button" onClick={clearCart} disabled={submitting || checkingAvailability}>
            Clear cart
          </button>
          <button type="submit" disabled={submitting || checkingAvailability || availableItems.length === 0}>
            {checkingAvailability ? 'Checking availability…' : submitting ? 'Opening payment…' : `Pay ${formatPrice(amountDue)} & book`}
          </button>
        </div>
      </form>

      {termsOpen && (
        <TermsGateModal
          title={`Before you book ${availableItems.length} item${availableItems.length > 1 ? 's' : ''}`}
          continueLabel="Continue to payment"
          onAgree={submitBookings}
          onClose={() => setTermsOpen(false)}
        />
      )}
    </div>
  );
}
