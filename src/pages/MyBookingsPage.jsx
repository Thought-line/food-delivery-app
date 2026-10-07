import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/useAuth';
import { useCart } from '../lib/useCart';
import { useBookingNotifications } from '../lib/useBookingNotifications';
import { formatPrice } from '../lib/common';
import { todayISO, daysOverdue, formatDate } from '../lib/dateUtils';
import { createBalanceOrder, cancelMyBooking, openRazorpayCheckout } from '../lib/payments';
import { getSignedInvoiceUrl } from '../lib/invoices';
import { getCancellationTerms } from '../lib/cancellationTerms';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import StatusBadge from '../components/ui/StatusBadge';
import Loading from '../components/ui/Loading';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import PhotoPlaceholder from '../components/ui/PhotoPlaceholder';
// .camera-thumb-placeholder is the catalogue grid's own "no photo yet"
// style, reused here (and on WishlistPage) rather than duplicated.
import '../components/CameraList.css';
import './MyBookingsPage.css';

// Turns the raw database status into friendly text shown on the badge
const STATUS_LABELS = {
  requested: 'Pending approval',
  confirmed: 'Confirmed',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

const PAYMENT_LABELS = {
  pending: 'Payment pending',
  advance_paid: 'Advance paid',
  paid: 'Paid in full',
  refund_pending: 'Refund on the way',
  refunded: 'Refunded',
};

export default function MyBookingsPage() {
  const { user } = useAuth(); // the currently logged-in customer
  const { showToast } = useCart(); // same shared toast used app-wide (cart/wishlist/review/logout)
  const { markSeen } = useBookingNotifications();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [payingId, setPayingId] = useState(null);
  const [payError, setPayError] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null); // booking pending cancel confirmation, or null
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  // Fetch only this user's bookings, newest first, along with each camera's name
  async function loadBookings() {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('bookings')
      .select(
        'id, created_at, start_date, end_date, status, quantity, payment_status, amount_total, amount_paid, invoice_path, cameras(name, price, photos, image_url)'
      )
      .eq('customer_id', user.id)
      .order('start_date', { ascending: false });

    if (fetchError) setError(fetchError.message);
    else setBookings(data);
    setLoading(false);
  }

  async function downloadInvoice(booking) {
    setDownloadError(null);
    setDownloadingId(booking.id);
    try {
      const url = await getSignedInvoiceUrl(booking.invoice_path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setDownloadError(err.message || 'Could not open the invoice.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function payBalance(booking) {
    setPayError(null);
    setPayingId(booking.id);
    try {
      const order = await createBalanceOrder(booking.id);
      await openRazorpayCheckout({
        order,
        description: `${booking.cameras?.name ?? 'Camera'} — balance`,
        onSuccess: () => {
          setPayingId(null);
          loadBookings();
        },
        onError: (err, info) => {
          setPayingId(null);
          setPayError(
            info?.paid
              ? 'Payment received — updating your booking in a moment.'
              : err.message || 'Payment failed. Please try again.'
          );
          if (info?.paid) loadBookings();
        },
        onDismiss: () => setPayingId(null),
      });
    } catch (err) {
      setPayingId(null);
      setPayError(err.message || 'Could not start the payment.');
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    // Just a preview for the toast wording — the server independently
    // recomputes the real terms (with its own clock) inside
    // cancel_my_booking(), regardless of how long this dialog sat open.
    const terms = getCancellationTerms(
      { createdAt: cancelTarget.created_at, startDate: cancelTarget.start_date, amountPaid: cancelTarget.amount_paid },
      new Date()
    );
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelMyBooking(cancelTarget.id);
      setCancelTarget(null);
      showToast(
        'success',
        terms.feePercent >= 100
          ? 'Booking cancelled — non-refundable at this stage.'
          : terms.fee > 0
            ? `Booking cancelled — ${formatPrice(terms.fee)} fee applied, ${formatPrice(terms.refund)} refund on the way (4–7 working days).`
            : `Booking cancelled — full refund of ${formatPrice(terms.refund)} on the way.`
      );
      loadBookings();
    } catch (err) {
      setCancelError(err.message || 'Could not cancel this booking.');
    } finally {
      setCancelling(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBookings();
    // Opening this page is what "viewing" the notifications means — clears
    // the navbar's My Bookings badge regardless of how the customer got here
    // (the badge itself, the toast, or just clicking the nav link directly).
    markSeen();

    // Reload automatically if any of this user's bookings change
    // (e.g. an admin confirms or rejects one) while this page is open
    const channel = supabase
      .channel('my-bookings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${user.id}` },
        () => loadBookings()
      )
      .subscribe();

    // Stop listening when the page closes
    return () => supabase.removeChannel(channel);
  }, [user.id, markSeen]);
  return (
    <div className="my-bookings">
      <div className="my-bookings-header">
        <h2>My Bookings{bookings.length > 0 ? ` (${bookings.length})` : ''}</h2>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {payError && <p className="error" role="alert">{payError}</p>}
      {downloadError && <p className="error" role="alert">{downloadError}</p>}
      {loading && <Loading />}

      {!loading && bookings.length === 0 && <p>You haven't made any bookings yet.</p>}

      {!loading && bookings.length > 0 && (
        <ul className="booking-list">
          {bookings.map((b) => {
            const isOverdue = b.status === 'active' && b.end_date < todayISO();
            const dueAmount = isOverdue
              ? daysOverdue(b.end_date) * (b.cameras?.price ?? 0) * (b.quantity ?? 1)
              : 0;
            const balance = Math.max(0, Number(b.amount_total ?? 0) - Number(b.amount_paid ?? 0));
            const showsPayment = b.payment_status && b.payment_status !== 'unpaid';
            const canPayBalance =
              b.payment_status === 'advance_paid' &&
              balance > 0 &&
              ['confirmed', 'active'].includes(b.status);

            const photo = getCameraPhotoUrl(b.cameras ?? {});
            const hasActions = canPayBalance || b.status === 'confirmed' || b.invoice_path || isOverdue;

            return (
            <li key={b.id} className="booking-card">
              <div className="booking-card-top">
                <div className="booking-card-thumb">
                  {photo ? (
                    <img src={photo} alt={b.cameras?.name ?? 'Camera'} loading="lazy" />
                  ) : (
                    <PhotoPlaceholder size={28} className="camera-thumb-placeholder" />
                  )}
                </div>

                <div className="booking-card-main">
                  <span className="booking-camera">
                    {b.cameras?.name}
                    {b.quantity > 1 && ` × ${b.quantity}`}
                  </span>
                  <span className="booking-dates">{formatDate(b.start_date)} → {formatDate(b.end_date)}</span>
                  {showsPayment && (
                    <span className="booking-payment">
                      {PAYMENT_LABELS[b.payment_status] ?? b.payment_status}
                      {b.payment_status === 'advance_paid' && balance > 0 && (
                        <> · {formatPrice(balance)} balance due</>
                      )}
                    </span>
                  )}
                </div>
              </div>

              {/* Badge stacked directly above the actions, both right-aligned
                  in one tight column — same grouping as the wishlist cards'
                  badge-above-trash corner. */}
              <div className="booking-card-side">
                {/* Falls back to the raw status text if it's not in STATUS_LABELS */}
                <StatusBadge status={b.status} label={STATUS_LABELS[b.status]} />

                {hasActions && (
                  <div className="booking-card-actions">
                    {isOverdue && (
                      <span className="booking-overdue-badge">
                        Overdue · {formatPrice(dueAmount)} due
                      </span>
                    )}
                    {canPayBalance && (
                      <button
                        type="button"
                        className="booking-pay-balance"
                        disabled={payingId === b.id}
                        onClick={() => payBalance(b)}
                      >
                        {payingId === b.id ? 'Opening payment…' : `Pay balance (${formatPrice(balance)})`}
                      </button>
                    )}
                    {b.status === 'confirmed' && (
                      <button
                        type="button"
                        className="booking-cancel-btn"
                        onClick={() => setCancelTarget(b)}
                      >
                        Cancel booking
                      </button>
                    )}
                    {b.invoice_path && (
                      <button
                        type="button"
                        className="booking-invoice-btn"
                        disabled={downloadingId === b.id}
                        onClick={() => downloadInvoice(b)}
                      >
                        {downloadingId === b.id ? 'Opening…' : 'Download Invoice'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Cancel this booking?"
          description={(() => {
            if (!(cancelTarget.payment_status === 'advance_paid' || cancelTarget.payment_status === 'paid')) {
              return 'This booking will be cancelled.';
            }
            // Preview only — recomputed fresh (server clock, stored data)
            // inside cancel_my_booking() when the admin actually confirms,
            // so it can't drift even if this dialog sits open a while.
            const terms = getCancellationTerms(
              { createdAt: cancelTarget.created_at, startDate: cancelTarget.start_date, amountPaid: cancelTarget.amount_paid },
              new Date()
            );
            if (terms.feePercent >= 100) {
              return 'This booking is non-refundable at this stage. No refund will be issued.';
            }
            if (terms.fee > 0) {
              return `A ${formatPrice(terms.fee)} cancellation fee applies. You will receive ${formatPrice(terms.refund)} as a refund within 4–7 working days.`;
            }
            return `You'll receive a full refund of ${formatPrice(terms.refund)}.`;
          })()}
          confirmLabel="Cancel booking"
          confirmBusyLabel="Cancelling…"
          cancelLabel="Keep booking"
          busy={cancelling}
          onConfirm={confirmCancel}
          onCancel={() => setCancelTarget(null)}
        >
          {cancelError && <p className="error" role="alert">{cancelError}</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
