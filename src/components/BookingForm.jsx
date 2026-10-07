import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuthGate } from '../lib/useAuthGate';
import { useCart } from '../lib/useCart';
import { useRentalRange } from '../lib/useRentalRange';
import { useProfileContactDefaults } from '../lib/useProfileContactDefaults';
import {
  getRemainingUnits,
  getCameraDailyAvailability,
  quantityAwareDayStatus,
  findShortDates,
  formatShortDatesMessage,
  isStockUnavailableError,
  STOCK_UNAVAILABLE_MESSAGE,
} from '../lib/availability';
import { formatDate, toISODate, isoToLocalDate, todayISO, addDaysISO } from '../lib/dateUtils';
import { getNameError, getPhoneError, getLocationError } from '../lib/contactValidation';
import { formatPrice } from '../lib/common';
import { rentalDays } from '../lib/rentalDays';
import { createBookingOrder, openRazorpayCheckout, advanceEstimate } from '../lib/payments';
import QuantityStepper from './QuantityStepper';
import DateRangePicker from './DateRangePicker';
import ContactFields from './ContactFields';
import PaymentOptions from './PaymentOptions';
import MessagePopup from './ui/MessagePopup';
import BookingConfirmedPopup from './ui/BookingConfirmedPopup';
import './BookingForm.css';

export default function BookingForm({ camera, dates, initialQuantity, onDone }) {
  const { requireAuth } = useAuthGate();
  const { showToast } = useCart();
  // Editing dates here writes back to the same shared range the navbar
  // picker reads/writes — this is just a closer-at-hand editor for it, not
  // a separate, independent set of dates (unlike the cart, where each item
  // keeps its own).
  const { setRange } = useRentalRange();
  const routerLocation = useLocation();
  const navigate = useNavigate();
  // If rental dates were already picked on the camera list, reuse them and skip asking again.
  const datesPreset = Boolean(dates?.start && dates?.end);

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  useProfileContactDefaults({ setName, setPhone, setLocation });
  const [startDate, setStartDate] = useState(dates?.start ?? '');
  const [endDate, setEndDate] = useState(dates?.end ?? '');
  const [quantity, setQuantity] = useState(Math.max(1, initialQuantity ?? 1));
  const [paymentOption, setPaymentOption] = useState('full'); // 'full' | 'advance'
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState(null);
  const [unitsAvailable, setUnitsAvailable] = useState(null); // null = not checked yet for the current dates
  const [fieldErrors, setFieldErrors] = useState({}); // per-field messages shown under each input
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(null); // heading for the error popup; null = generic default
  const [success, setSuccess] = useState(false);
  const [confirmedBookingId, setConfirmedBookingId] = useState(null);
  const [invoicePath, setInvoicePath] = useState(null); // set only once a full payment has an invoice on file

  // Sets the error popup's message + heading together so they never drift
  // out of sync (e.g. a later generic error showing a stale custom title).
  function showError(message, title = null) {
    setErrorTitle(title);
    setError(message);
  }

  // Booked/available tint for the date picker below — fetched once for a
  // generous 6-month window (rather than tracking whatever month the picker
  // happens to be showing) since DateRangePicker doesn't expose its own
  // month-navigation. A date past that window just renders untinted.
  const [dayData, setDayData] = useState({});
  useEffect(() => {
    let cancelled = false;
    getCameraDailyAvailability(camera.id, todayISO(), addDaysISO(todayISO(), 180))
      .then((data) => {
        if (!cancelled) setDayData(data);
      })
      .catch(() => {}); // purely decorative — a failed fetch just leaves days untinted
    return () => {
      cancelled = true;
    };
  }, [camera.id]);

  // Quantity-aware: recolors live as the customer changes `quantity`, not
  // just "is anything left" — a day with 2 of 3 units free reads as tight
  // (amber) once they ask for 2+, but stays green while they only want 1.
  // A plain function (not memoized), so it's freshly recreated every render
  // and always closes over the current `quantity`.
  function dayStatus(iso) {
    const d = dayData[iso];
    if (!d) return undefined;
    return quantityAwareDayStatus(d.available, quantity);
  }

  // Exact units-left tooltip for the calendar (see DateRangePicker's
  // `dayAvailable` prop) — the color alone only says relative tightness.
  function dayAvailable(iso) {
    return dayData[iso]?.available;
  }

  // Keep the form in step with the shared navbar date picker: whenever the
  // passed-in rental dates change, adopt them and re-check availability for
  // the new range. Also covers the initial mount.
  useEffect(() => {
    if (!dates?.start || !dates?.end) return;
    setStartDate(dates.start);
    setEndDate(dates.end);
    setFieldErrors((prev) => (prev.dates ? { ...prev, dates: undefined } : prev));
    checkAvailability(dates.start, dates.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates?.start, dates?.end]);

  async function checkAvailability(s = startDate, e = endDate) {
    if (!s || !e) return;
    setChecking(true);
    setConflictWarning(null);
    setUnitsAvailable(null);

    try {
      const remaining = await getRemainingUnits(camera, s, e);
      setUnitsAvailable(remaining);
      setQuantity((q) => Math.min(Math.max(1, q), Math.max(remaining, 1)));
      if (remaining <= 0) {
        setConflictWarning(STOCK_UNAVAILABLE_MESSAGE);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    showError(null);

    // Safety net: the session can lapse (idle auto-logout) while the form is
    // open. Catch it here with the same prompt instead of a raw RPC error.
    if (!requireAuth(routerLocation.pathname + routerLocation.search)) return;

    const errors = {
      name: getNameError(name),
      phone: getPhoneError(phone),
      location: getLocationError(location),
    };
    if (!startDate || !endDate) {
      errors.dates = 'Please choose both rental dates.';
    } else if (new Date(endDate) <= new Date(startDate)) {
      errors.dates = 'End date must be after the start date.';
    }
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setSubmitting(true);

    // Re-check right before submitting — the dates may have been available
    // when last checked but booked by someone else since then.
    let remaining;
    try {
      remaining = await getRemainingUnits(camera, startDate, endDate);
    } catch (err) {
      setSubmitting(false);
      showError(err.message);
      return;
    }
    if (remaining < quantity) {
      setSubmitting(false);
      setUnitsAvailable(remaining);
      setQuantity((q) => Math.min(q, Math.max(remaining, 1)));
      // Name the actual short dates instead of a flat "not available" for
      // the whole range — falls back to the generic message if this extra
      // per-day lookup itself fails, so a network hiccup here never blocks
      // the user from at least seeing why the booking can't go through.
      try {
        const shortDates = await findShortDates(camera, startDate, endDate, quantity);
        setConflictWarning(formatShortDatesMessage(shortDates) ?? STOCK_UNAVAILABLE_MESSAGE);
      } catch {
        setConflictWarning(STOCK_UNAVAILABLE_MESSAGE);
      }
      return;
    }

    // Create the hold + Razorpay order server-side, then open checkout. The
    // booking is only confirmed once payment is captured; if the customer
    // closes the modal the hold is released (here immediately, and by the
    // reaper as a backstop).
    let order;
    try {
      order = await createBookingOrder({
        item: { camera_id: camera.id, start_date: startDate, end_date: endDate, quantity },
        paymentOption,
        name: name.trim(),
        location: location.trim(),
        phone: phone.trim(),
      });
    } catch (err) {
      setSubmitting(false);
      if (err.code === 'unavailable' || isStockUnavailableError(err)) {
        setConflictWarning(STOCK_UNAVAILABLE_MESSAGE);
      } else {
        showError(err.message);
      }
      return;
    }

    const heldBookingId = order.booking_ids?.[0];
    const releaseHold = () => {
      if (heldBookingId) {
        supabase.rpc('cancel_unpaid_hold', { p_booking_id: heldBookingId }).catch(() => {});
      }
    };

    try {
      await openRazorpayCheckout({
        order,
        description: `${camera.name} rental`,
        prefill: { name: name.trim(), contact: phone.trim() },
        onSuccess: async () => {
          setSubmitting(false);
          setConfirmedBookingId(heldBookingId);
          setSuccess(true);
          // By the time onSuccess fires, verify-payment has already awaited
          // full settlement (invoice generation included) for a full
          // payment — so this is usually already set. Not guaranteed if the
          // webhook happened to win the settle race instead and is still
          // mid-flight on the invoice step; the popup just won't show the
          // download card in that rare case (it's still emailed, and always
          // downloadable later from My Bookings).
          if (heldBookingId) {
            const { data } = await supabase
              .from('bookings')
              .select('invoice_path')
              .eq('id', heldBookingId)
              .single();
            if (data?.invoice_path) setInvoicePath(data.invoice_path);
          }
        },
        onError: (err, info) => {
          setSubmitting(false);
          if (info?.paid) {
            // Money was taken but the confirm call failed — the webhook will
            // finish it. Don't release the hold.
            showError('Finalizing your booking. Check My Bookings in a moment.', 'Payment Received');
          } else {
            showError(
              `${err.message || 'The payment did not go through'} — this booking hasn't been confirmed. You can try again.`,
              'Booking Not Confirmed'
            );
            releaseHold();
          }
        },
        onDismiss: () => {
          setSubmitting(false);
          showError(
            "Your payment wasn't completed, so this booking hasn't been confirmed. You can try again anytime.",
            'Booking Not Confirmed'
          );
          releaseHold();
        },
      });
    } catch (err) {
      setSubmitting(false);
      showError(err.message || 'Could not open payment. Please try again.');
      releaseHold();
    }
  }

  const estTotal = (camera.price ?? 0) * quantity * (rentalDays(startDate, endDate) ?? 1);
  const estAdvance = advanceEstimate(estTotal);
  const amountDue = paymentOption === 'advance' ? estAdvance : estTotal;

  if (success) {
    const paymentSummary =
      paymentOption === 'advance'
        ? `${formatPrice(estAdvance)} paid · ${formatPrice(estTotal - estAdvance)} balance due at pickup`
        : `${formatPrice(estTotal)} paid in full`;
    return (
      <BookingConfirmedPopup
        rows={[
          { label: 'Booking ID', value: confirmedBookingId?.slice(0, 8).toUpperCase() },
          { label: 'Camera', value: quantity > 1 ? `${quantity} × ${camera.name}` : camera.name },
          { label: 'Dates', value: `${formatDate(startDate)} → ${formatDate(endDate)}` },
          { label: 'Payment', value: paymentSummary },
        ]}
        invoice={invoicePath ? { path: invoicePath, filename: `Invoice_${confirmedBookingId.slice(0, 8)}.pdf` } : undefined}
        notice="Check your email for a pickup verification code — our staff will ask for it when you collect the camera."
        primaryLabel="View my bookings"
        onPrimaryAction={() => navigate('/my-bookings')}
        // Same "go back to browsing" destination as the form's own Cancel —
        // the only other place this stage can reasonably send someone.
        onClose={onDone}
      />
    );
  }

  return (
    <form className="booking-form" onSubmit={handleSubmit} noValidate>
      <h3>Reserve {camera.name}</h3>

      <ContactFields
        name={name} onNameChange={setName}
        phone={phone} onPhoneChange={setPhone}
        location={location} onLocationChange={setLocation}
        fieldErrors={fieldErrors} setFieldErrors={setFieldErrors}
      />

      {datesPreset ? (
        <div className="booking-dates-summary">
          <span className="booking-dates-label">Rental dates</span>
          <DateRangePicker
            variant="pill"
            compact
            editAccent
            initialStart={startDate ? isoToLocalDate(startDate) : null}
            initialEnd={endDate ? isoToLocalDate(endDate) : null}
            onChange={(start, end) =>
              setRange({ start: toISODate(start), end: toISODate(end) })
            }
            dayStatus={dayStatus}
            dayAvailable={dayAvailable}
          />
        </div>
      ) : (
        <>
          <label>
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setUnitsAvailable(null);
                setConflictWarning(null);
                setFieldErrors((prev) => ({ ...prev, dates: undefined }));
              }}
              onBlur={() => checkAvailability()}
            />
          </label>

          <label>
            End date
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setUnitsAvailable(null);
                setConflictWarning(null);
                setFieldErrors((prev) => ({ ...prev, dates: undefined }));
              }}
              onBlur={() => checkAvailability()}
            />
          </label>
        </>
      )}

      {fieldErrors.dates && <span className="field-error field-error-dates">{fieldErrors.dates}</span>}

      {checking && <p className="hint">Checking availability…</p>}

      {unitsAvailable !== null && unitsAvailable > 0 && (
        <div className="booking-quantity-row">
          <span>Quantity</span>
          <QuantityStepper
            quantity={quantity}
            available={unitsAvailable}
            onDecrement={() => setQuantity((q) => Math.max(1, q - 1))}
            onIncrement={() => {
              if (quantity < unitsAvailable) {
                setQuantity((q) => q + 1);
              } else {
                showToast('warning', 'Maximum available quantity reached');
              }
            }}
          />
          <span className="availability-hint">{quantity} of {unitsAvailable} available</span>
        </div>
      )}

      {unitsAvailable !== null && unitsAvailable > 0 && (
        <PaymentOptions total={estTotal} value={paymentOption} onChange={setPaymentOption} />
      )}

      {conflictWarning && <p className="error" role="alert">{conflictWarning}</p>}
      <MessagePopup message={error} title={errorTitle ?? undefined} onClose={() => showError(null)} />

      <div className="actions">
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="submit" disabled={submitting || checking || (unitsAvailable !== null && unitsAvailable <= 0)}>
          {submitting ? 'Opening payment…' : `Pay ${formatPrice(amountDue)} & book`}
        </button>
      </div>
    </form>
  );
}
