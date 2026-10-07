import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  getCameraDailyAvailability,
  getRemainingUnits,
  quantityAwareDayStatus,
  findShortDates,
  formatShortDatesMessage,
  isStockUnavailableError,
  STOCK_UNAVAILABLE_ADMIN_MESSAGE,
} from '../lib/availability';
import { adminBlockCamera } from '../lib/cameraHolds';
import { getNameError } from '../lib/contactValidation';
import { advanceEstimate } from '../lib/payments';
import { toISODate, formatDate } from '../lib/dateUtils';
import { startOfMonth, addMonths } from '../lib/calendarGrid';
import { rentalDays } from '../lib/rentalDays';
import { formatPrice } from '../lib/common';
import Modal from './ui/Modal';
import CloseButton from './ui/CloseButton';
import Button from './ui/Button';
import Loading from './ui/Loading';
import StatusBadge from './ui/StatusBadge';
import AvailabilityCalendar from './AvailabilityCalendar';
import QuantityStepper from './QuantityStepper';
import './CameraAvailabilityModal.css';

// Stricter than contactValidation.js's shared getPhoneError (which only
// checks non-empty) — kept local to this admin form rather than tightening
// the shared customer-facing validator, since that also drives
// BookingForm.jsx/CartPage.jsx and changing its rule wasn't asked for.
function getPersonPhoneError(phone) {
  const trimmed = phone.trim();
  if (!trimmed) return 'Phone number is required.';
  if (!/^\d{10}$/.test(trimmed)) return 'Enter a valid 10-digit phone number.';
  return undefined;
}

// A maintenance hold takes a camera off the booking calendar with no
// explanation otherwise on record — require a reason so it's clear later
// (to this admin or another one) why those dates were blocked.
function getMaintenanceNoteError(note) {
  if (!note.trim()) return 'Reason for maintenance is required.';
  return undefined;
}

// Admin "View availability" — a per-camera calendar (booked vs. free, tinted
// per day) plus the camera's upcoming bookings, and a "block these dates"
// mini-form that reserves the camera the same way a real booking does (see
// admin_block_camera in supabase/migrations/20260911030000_...).
export default function CameraAvailabilityModal({ camera, onClose }) {
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [dayData, setDayData] = useState({});
  const [calendarError, setCalendarError] = useState(null);

  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);

  const [selectedStart, setSelectedStart] = useState(null);
  const [selectedEnd, setSelectedEnd] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [rangeAvailable, setRangeAvailable] = useState(null);
  // Names the exact days (within the selected range) short of `quantity` —
  // same findShortDates/formatShortDatesMessage pair BookingForm.jsx uses.
  const [shortDatesMessage, setShortDatesMessage] = useState(null);
  // Why the camera's being blocked — 'maintenance' just needs a reason;
  // 'person' is an offline/walk-in/phone booking, so it needs who it's for
  // and what they paid (same shape a real booking has).
  const [holdType, setHoldType] = useState('maintenance');
  const [maintenanceNote, setMaintenanceNote] = useState('');
  const [maintenanceNoteError, setMaintenanceNoteError] = useState(null);
  const [personName, setPersonName] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  // { name?, phone? } — validated on submit, same as ProfilePage/BookingForm.
  const [personFieldErrors, setPersonFieldErrors] = useState({});
  // 'full' or 'advance' (25%) — the total itself is computed server-side
  // from the camera's own price, same as a real booking.
  const [paymentType, setPaymentType] = useState('full');
  const [submitting, setSubmitting] = useState(false);
  const [blockError, setBlockError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Per-day availability for the visible month, padded a week either side
  // since the grid also shows a few adjacent-month days. A plain fetch (no
  // state writes) so both the month-change effect and the post-block refresh
  // below can each apply the result under their own staleness guard.
  function fetchCalendarData(vd) {
    const gridStart = new Date(vd.getFullYear(), vd.getMonth(), -6);
    const gridEnd = new Date(vd.getFullYear(), vd.getMonth() + 1, 6);
    return getCameraDailyAvailability(camera.id, toISODate(gridStart), toISODate(gridEnd));
  }

  useEffect(() => {
    let cancelled = false;
    setCalendarError(null);
    fetchCalendarData(viewDate)
      .then((data) => {
        if (!cancelled) setDayData(data);
      })
      .catch((err) => {
        if (!cancelled) setCalendarError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, camera.id]);

  // This camera's own upcoming bookings — plain admin-scoped select, same
  // access AdminPanel.jsx already has via the bookings_select_admin policy.
  async function loadBookings() {
    setLoadingBookings(true);
    const { data, error } = await supabase
      .from('bookings')
      .select('id, start_date, end_date, status, quantity, customer_name, is_admin_hold, hold_type, profiles:customer_id(email)')
      .eq('camera_id', camera.id)
      .in('status', ['confirmed', 'active'])
      .order('start_date', { ascending: true });
    if (!error) setBookings(data ?? []);
    setLoadingBookings(false);
  }

  useEffect(() => {
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id]);

  // Keep the quantity stepper's cap right for whichever range is selected.
  // Depends on camera.id, not the whole `camera` object — that object isn't
  // referentially stable across the parent's re-renders, and depending on
  // it directly here (the one place in this file that did) made this effect
  // re-fire, and re-hit the network, far more than intended.
  useEffect(() => {
    if (!selectedStart || !selectedEnd) {
      setRangeAvailable(null);
      return;
    }
    let cancelled = false;
    getRemainingUnits(camera, toISODate(selectedStart), toISODate(selectedEnd))
      .then((remaining) => {
        if (cancelled) return;
        setRangeAvailable(remaining);
        setQuantity((q) => Math.min(Math.max(1, q), Math.max(remaining, 1)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStart, selectedEnd, camera.id]);

  // Proactive per-day check: once rangeAvailable flags that this quantity
  // won't fit somewhere in the range, name the exact short days — same
  // findShortDates/formatShortDatesMessage pair BookingForm.jsx uses at
  // submit time, just surfaced live here so the admin sees it before
  // clicking Block. Gated on rangeAvailable < quantity (findShortDates'
  // own documented calling condition) so a happy-path range/quantity never
  // pays for the extra RPC round-trip.
  useEffect(() => {
    if (!selectedStart || !selectedEnd || rangeAvailable === null || rangeAvailable >= quantity) {
      setShortDatesMessage(null);
      return;
    }
    let cancelled = false;
    findShortDates(camera, toISODate(selectedStart), toISODate(selectedEnd), quantity)
      .then((shortDates) => {
        if (!cancelled) setShortDatesMessage(formatShortDatesMessage(shortDates) ?? STOCK_UNAVAILABLE_ADMIN_MESSAGE);
      })
      .catch(() => {
        if (!cancelled) setShortDatesMessage(STOCK_UNAVAILABLE_ADMIN_MESSAGE);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStart, selectedEnd, camera.id, quantity, rangeAvailable]);

  // Quantity-aware: recolors live as the admin changes `quantity`, not just
  // "is anything left" — mirrors BookingForm.jsx's own dayStatus.
  function dayStatus(iso) {
    const d = dayData[iso];
    if (!d) return undefined;
    return quantityAwareDayStatus(d.available, quantity);
  }

  // Exact units-left tooltip for the calendar — same data, same hover
  // tooltip the customer-facing booking form shows (see BookingForm.jsx's
  // own dayAvailable), just admin-side.
  function dayAvailable(iso) {
    return dayData[iso]?.available;
  }

  function clearSelection() {
    setSelectedStart(null);
    setSelectedEnd(null);
    setHoldType('maintenance');
    setMaintenanceNote('');
    setMaintenanceNoteError(null);
    setPersonName('');
    setPersonPhone('');
    setPersonFieldErrors({});
    setPaymentType('full');
    setQuantity(1);
    setBlockError(null);
    setShortDatesMessage(null);
  }

  async function handleBlock() {
    if (!selectedStart || !selectedEnd) return;
    if (holdType === 'maintenance') {
      const noteError = getMaintenanceNoteError(maintenanceNote);
      setMaintenanceNoteError(noteError);
      if (noteError) return;
    } else if (holdType === 'person') {
      const errors = {
        name: getNameError(personName),
        phone: getPersonPhoneError(personPhone),
      };
      setPersonFieldErrors(errors);
      if (Object.values(errors).some(Boolean)) return;
    }
    setSubmitting(true);
    setBlockError(null);
    setSuccessMsg(null);

    const start = toISODate(selectedStart);
    const end = toISODate(selectedEnd);

    // Re-check right before submitting — the dates may have been available
    // when last checked but booked by someone else (or another admin) since.
    let remaining;
    try {
      remaining = await getRemainingUnits(camera, start, end);
    } catch (err) {
      setSubmitting(false);
      setBlockError(err.message);
      return;
    }
    if (remaining < quantity) {
      setSubmitting(false);
      setRangeAvailable(remaining);
      setQuantity((q) => Math.min(q, Math.max(remaining, 1)));
      try {
        const shortDates = await findShortDates(camera, start, end, quantity);
        setShortDatesMessage(formatShortDatesMessage(shortDates) ?? STOCK_UNAVAILABLE_ADMIN_MESSAGE);
      } catch {
        setShortDatesMessage(STOCK_UNAVAILABLE_ADMIN_MESSAGE);
      }
      return;
    }

    try {
      await adminBlockCamera(camera.id, start, end, quantity, {
        holdType,
        maintenanceNote: maintenanceNote.trim(),
        customerName: personName.trim(),
        customerPhone: personPhone.trim(),
        paymentType,
      });
      setSuccessMsg('Dates blocked.');
      clearSelection();
      const [, freshDayData] = await Promise.all([loadBookings(), fetchCalendarData(viewDate)]);
      setDayData(freshDayData);
    } catch (err) {
      setBlockError(isStockUnavailableError(err) ? STOCK_UNAVAILABLE_ADMIN_MESSAGE : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal overlayClassName="cam-avail-overlay" modalClassName="cam-avail-modal" onClose={onClose}>
      <CloseButton className="cam-avail-close" onClick={onClose} />

      <h3 className="cam-avail-title">{camera.name}</h3>
      <p className="cam-avail-subtitle">{camera.model}</p>

      <div className="cam-avail-body">
        <div className="cam-avail-calendar-col">
          <AvailabilityCalendar
            viewDate={viewDate}
            onPrevMonth={() => setViewDate((d) => addMonths(d, -1))}
            onNextMonth={() => setViewDate((d) => addMonths(d, 1))}
            dayStatus={dayStatus}
            dayAvailable={dayAvailable}
            selectedStart={selectedStart}
            selectedEnd={selectedEnd}
            onSelectStart={setSelectedStart}
            onSelectEnd={setSelectedEnd}
          />
          {calendarError && <p className="error" role="alert">{calendarError}</p>}

          <div className="cam-avail-block-form">
            <h4>Block these dates</h4>
            {!selectedStart && (
              <p className="hint">Click a start date, then an end date, on the calendar to block a range.</p>
            )}
            {selectedStart && !selectedEnd && <p className="hint">Pick an end date to continue.</p>}
            {selectedStart && selectedEnd && (
              <>
                <p className="cam-avail-block-range">
                  {formatDate(toISODate(selectedStart))} → {formatDate(toISODate(selectedEnd))}
                </p>
                <div className="cam-avail-block-qty-row">
                  <span>Quantity</span>
                  <QuantityStepper
                    quantity={quantity}
                    available={Math.max(rangeAvailable ?? 1, 1)}
                    onDecrement={() => setQuantity((q) => Math.max(1, q - 1))}
                    onIncrement={() => setQuantity((q) => Math.min(q + 1, Math.max(rangeAvailable ?? 1, 1)))}
                  />
                  {rangeAvailable !== null && (
                    <span className="hint">{rangeAvailable} of {camera.stock_quantity} free</span>
                  )}
                </div>
                {shortDatesMessage && (
                  <p className="warning" role="alert">{shortDatesMessage}</p>
                )}
                <div className="cam-avail-hold-type-row">
                  <label className={holdType === 'maintenance' ? 'is-active' : ''}>
                    <input
                      type="radio"
                      name="cam-avail-hold-type"
                      value="maintenance"
                      checked={holdType === 'maintenance'}
                      onChange={() => {
                        setHoldType('maintenance');
                        setPersonFieldErrors({});
                      }}
                    />
                    Maintenance
                  </label>
                  <label className={holdType === 'person' ? 'is-active' : ''}>
                    <input
                      type="radio"
                      name="cam-avail-hold-type"
                      value="person"
                      checked={holdType === 'person'}
                      onChange={() => {
                        setHoldType('person');
                        setMaintenanceNoteError(null);
                      }}
                    />
                    Booking for a person
                  </label>
                </div>

                {holdType === 'maintenance' ? (
                  <>
                    <input
                      type="text"
                      className={`cam-avail-note-input${maintenanceNoteError ? ' has-error' : ''}`}
                      placeholder="Maintenance reason (e.g. sensor cleaning, repair) *"
                      value={maintenanceNote}
                      onChange={(e) => {
                        setMaintenanceNote(e.target.value);
                        if (maintenanceNoteError) setMaintenanceNoteError(getMaintenanceNoteError(e.target.value));
                      }}
                      onBlur={() => setMaintenanceNoteError(getMaintenanceNoteError(maintenanceNote))}
                    />
                    {maintenanceNoteError && <span className="field-error">{maintenanceNoteError}</span>}
                  </>
                ) : (
                  <div className="cam-avail-person-fields">
                    <input
                      type="text"
                      className="cam-avail-note-input"
                      placeholder="Customer name"
                      value={personName}
                      onChange={(e) => {
                        setPersonName(e.target.value);
                        if (personFieldErrors.name) setPersonFieldErrors((prev) => ({ ...prev, name: undefined }));
                      }}
                    />
                    {personFieldErrors.name && <span className="field-error">{personFieldErrors.name}</span>}
                    <input
                      type="tel"
                      className="cam-avail-note-input"
                      placeholder="Phone number"
                      value={personPhone}
                      onChange={(e) => {
                        setPersonPhone(e.target.value);
                        if (personFieldErrors.phone) setPersonFieldErrors((prev) => ({ ...prev, phone: undefined }));
                      }}
                    />
                    {personFieldErrors.phone && <span className="field-error">{personFieldErrors.phone}</span>}
                    {camera.price > 0 && (() => {
                      const days = rentalDays(toISODate(selectedStart), toISODate(selectedEnd)) ?? 1;
                      const total = camera.price * quantity * days;
                      return (
                        <p className="cam-avail-amount-preview">
                          Total: {formatPrice(total)} · Advance (25%): {formatPrice(advanceEstimate(total))}
                        </p>
                      );
                    })()}
                    <div className="cam-avail-hold-type-row">
                      <label className={paymentType === 'full' ? 'is-active' : ''}>
                        <input
                          type="radio"
                          name="cam-avail-payment-type"
                          value="full"
                          checked={paymentType === 'full'}
                          onChange={() => setPaymentType('full')}
                        />
                        Full payment
                      </label>
                      <label className={paymentType === 'advance' ? 'is-active' : ''}>
                        <input
                          type="radio"
                          name="cam-avail-payment-type"
                          value="advance"
                          checked={paymentType === 'advance'}
                          onChange={() => setPaymentType('advance')}
                        />
                        Advance only
                      </label>
                    </div>
                  </div>
                )}

                <div className="cam-avail-block-actions">
                  <Button type="button" onClick={clearSelection} disabled={submitting}>
                    Clear
                  </Button>
                  <Button
                    type="button"
                    className="cam-avail-block-confirm"
                    onClick={handleBlock}
                    disabled={submitting || rangeAvailable === 0 || Boolean(shortDatesMessage)}
                  >
                    {submitting ? 'Blocking…' : 'Block these dates'}
                  </Button>
                </div>
              </>
            )}
            {blockError && <p className="error" role="alert">{blockError}</p>}
            {successMsg && <p className="cam-avail-success">{successMsg}</p>}
          </div>
        </div>

        <div className="cam-avail-bookings-col">
          <h4>Upcoming bookings</h4>
          {loadingBookings ? (
            <Loading />
          ) : bookings.length === 0 ? (
            <p className="hint">No upcoming bookings for this camera.</p>
          ) : (
            <ul className="cam-avail-booking-list">
              {bookings.map((b) => (
                <li key={b.id} className="cam-avail-booking-row">
                  <span className="cam-avail-booking-dates">
                    {formatDate(b.start_date)} → {formatDate(b.end_date)}
                  </span>
                  <span className="cam-avail-booking-meta">
                    <span className="cam-avail-booking-who">
                      {b.is_admin_hold ? (
                        b.hold_type === 'maintenance' ? (
                          <span className="admin-hold-badge">Maintenance</span>
                        ) : (
                          <>
                            <span className="admin-hold-badge">Admin hold</span> {b.customer_name}
                          </>
                        )
                      ) : (
                        b.customer_name || b.profiles?.email || 'Customer'
                      )}
                    </span>
                    <span className="cam-avail-booking-qty">×{b.quantity}</span>
                    <StatusBadge status={b.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
