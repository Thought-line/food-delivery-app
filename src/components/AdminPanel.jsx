import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {getCommittedUnits,isStockUnavailableError,STOCK_UNAVAILABLE_ADMIN_MESSAGE,} from '../lib/availability';
import { formatPrice } from '../lib/common';
import { todayISO, daysOverdue, formatDate } from '../lib/dateUtils';
import { useActionToast } from '../lib/useActionToast';
import ConfirmDialog from './ui/ConfirmDialog';
import TabGroup from './ui/TabGroup';
import Loading from './ui/Loading';
import ActionToast from './ui/ActionToast';
import BookingDetailsModal from './BookingDetailsModal';
import Pagination from './ui/Pagination';
import './AdminPanel.css';

const STATUS_FILTERS = ['all', 'confirmed', 'active', 'completed', 'cancelled', 'rejected'];
const TERMINAL_STATUSES = ['completed', 'cancelled', 'rejected'];
const PAGE_SIZE = 10;

// Tabs where an action would consume a unit of stock, so the admin needs
// to see up front whether the camera actually has one free for the dates.
const STOCK_CHECKED_STATUSES = ['confirmed'];

const CANCEL_QUESTION = 'Confirm you want to cancel this booking?';

const PICKUP_CODE_MISMATCH_MESSAGE =
  "That code doesn't match this booking's pickup code — check with the customer and try again.";

function isPickupCodeMismatchError(error) {
  return Boolean(error?.message?.includes('pickup_code_mismatch'));
}

// Every status-changing RPC here has a matching customer-facing email —
// see STATUS_CONTENT in supabase/functions/send-booking-status-email.
const STATUS_EMAIL_BY_RPC = {
  cancel_booking: 'cancelled',
  activate_booking: 'active',
  complete_booking: 'completed',
};

// Confirmation toast for the admin's own action — separate from the emailed
// notice above and from the customer-facing BookingStatusToast, since
// neither of those tells the admin, right here, that their click went
// through. Same success/warning split as BookingStatusToast's STATUS_COPY.
const ACTION_TOAST_BY_RPC = {
  cancel_booking: { message: 'Booking cancelled', type: 'warning' },
  activate_booking: { message: 'Booking marked active', type: 'success' },
  complete_booking: { message: 'Booking marked completed', type: 'success' },
};

export default function AdminPanel({ onBack, initialFilter }) {
  const [bookings, setBookings] = useState([]);
  // Deep-linked from an Overview stat card (?tab=bookings&status=...) — falls
  // back to the normal default when absent or not one of this page's own
  // filters, same idiom AdminPage.jsx uses for its own tab param.
  const [filter, setFilter] = useState(STATUS_FILTERS.includes(initialFilter) ? initialFilter : 'confirmed');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState(null);
  const [availability, setAvailability] = useState({});
  const { toast: actionToast, notify: notifyAction, close: closeActionToast } = useActionToast();
  const [pendingAction, setPendingAction] = useState(null); // { rpcName, bookingId, question } | null
  const [confirming, setConfirming] = useState(false);
  const [pickupCodeInput, setPickupCodeInput] = useState('');
  const [detailsBooking, setDetailsBooking] = useState(null); // the booking shown in BookingDetailsModal, or null
  const [page, setPage] = useState(1);

  async function loadBookings() {
    setLoading(true);
    let query = supabase
      .from('bookings')
      .select(
        'id, camera_id, start_date, end_date, status, quantity, payment_status, amount_total, amount_paid, customer_name, customer_location, customer_phone, created_at, is_admin_hold, hold_type, maintenance_note, identity_document_urls, identity_document_type, cameras(name, price, stock_quantity), profiles:customer_id(email)'
      );
    if (filter !== 'all') query = query.eq('status', filter);
    // Newest request first — the one that just came in shows at the top,
    // older ones settle toward the bottom, instead of the list being
    // ordered by the rental's own start_date (which says nothing about
    // request order).
    const { data, error } = await query.order('created_at', { ascending: false });

    if (!error) setBookings(data);
    setLoading(false);
  }

  useEffect(() => {
    setTimeout(loadBookings, 0);

    const channel = supabase
      .channel('admin-bookings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setBookings((prev) => {
              if (!prev.some((b) => b.id === payload.new.id)) return prev;
              if (filter === 'all' || payload.new.status === filter) {
                // Merge every raw column the realtime payload carries (status,
                // payment_status, amount_paid, identity_document_urls, ...) —
                // patching status alone left the rest stale until the next
                // full reload. payload.new never includes the joined
                // cameras/profiles objects, so those survive from `b` as-is.
                return prev.map((b) => (b.id === payload.new.id ? { ...b, ...payload.new } : b));
              }
              return prev.filter((b) => b.id !== payload.new.id);
            });
          } else {
            loadBookings();
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [filter]);

  // BookingDetailsModal shows a snapshot taken when "View Details" was
  // clicked — keep it in sync with `bookings` so a realtime update (e.g.
  // payment_status flipping to paid) shows up in an already-open modal
  // without the admin having to close and reopen it. Only patches when the
  // booking is still in the current tab's list; if it moved to a different
  // tab, the modal just keeps showing its last-known state.
  useEffect(() => {
    if (!detailsBooking) return;
    const updated = bookings.find((b) => b.id === detailsBooking.id);
    if (updated && updated !== detailsBooking) setDetailsBooking(updated);
  }, [bookings, detailsBooking]);

  // Work out, for every visible requested/confirmed booking, how many units
  // of its camera are still free for its dates once every OTHER
  // confirmed/active booking is accounted for. Re-runs whenever the list
  // changes (initial load, realtime status patch, tab switch).
  useEffect(() => {
    if (!STOCK_CHECKED_STATUSES.includes(filter) || bookings.length === 0) {
      setAvailability({});
      return;
    }

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        bookings.map(async (b) => {
          const needed = b.quantity ?? 1;
          const stock = b.cameras?.stock_quantity ?? 0;
          try {
            const committed = await getCommittedUnits(
              b.camera_id,
              b.start_date,
              b.end_date,
              b.id
            );
            const free = Math.max(stock - committed, 0);
            return [b.id, { free, needed, ok: free >= needed }];
          } catch {
            // Lookup failed — leave the button enabled; activate_booking /
            // the stock trigger still reject an over-commit server-side.
            return [b.id, { free: null, needed, ok: true }];
          }
        })
      );
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [bookings, filter]);

  async function handleAction(rpcName, bookingId, extraParams = {}) {
    setActionError(null);
    const { error } = await supabase.rpc(rpcName, { p_booking_id: bookingId, ...extraParams });

    if (error) {
      setActionError(
        isStockUnavailableError(error)
          ? STOCK_UNAVAILABLE_ADMIN_MESSAGE
          : isPickupCodeMismatchError(error)
            ? PICKUP_CODE_MISMATCH_MESSAGE
            : error.message
      );
      return false;
    }
    const actedOn = bookings.find((b) => b.id === bookingId);
    setBookings((prev) => prev.filter((b) => b.id !== bookingId));
    const toastInfo = ACTION_TOAST_BY_RPC[rpcName] ?? { message: 'Booking updated', type: 'success' };
    notifyAction(toastInfo.message, toastInfo.type);

    const status = STATUS_EMAIL_BY_RPC[rpcName];
    // An admin hold's customer_id is the admin's own account — skip the
    // "your booking was X" email so admins don't get emailed about their own
    // holds (see 20260911030000_camera_availability_admin_hold.sql).
    if (status && !actedOn?.is_admin_hold) {
      supabase.functions
        .invoke('send-booking-status-email', { body: { bookingId, status } })
        .catch(() => {}); // best-effort — never block the status update on email delivery
    }
    return true;
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    setConfirming(true);
    // The pickup code only matters for activate_booking — every other RPC
    // here ignores an unknown extra param... actually it doesn't, Postgres
    // would reject an unexpected named arg, so only pass it where it applies.
    const extraParams =
      pendingAction.rpcName === 'activate_booking'
        ? { p_pickup_code: pickupCodeInput.trim() || null }
        : {};
    const ok = await handleAction(pendingAction.rpcName, pendingAction.bookingId, extraParams);
    setConfirming(false);
    // Keep the dialog open on failure (e.g. a wrong pickup code) so the admin
    // can just retype it — closing would force clicking the button again.
    if (!ok) return;
    setPickupCodeInput('');
    setPendingAction(null);
  }
  const isTerminalTab = TERMINAL_STATUSES.includes(filter);
  const totalPages = Math.max(1, Math.ceil(bookings.length / PAGE_SIZE));

  // The list can shrink out from under the current page (an action removes
  // the last row on the last page, a realtime update moves a row to a
  // different tab) — snap back into range instead of showing an empty page.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const pagedBookings = bookings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Rendered both above and below the table — computed once so the two
  // spots can't drift apart.
  const paginationControl = totalPages > 1 && (
    <Pagination
      page={page}
      totalPages={totalPages}
      onPrev={() => setPage((p) => Math.max(1, p - 1))}
      onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      onSelect={setPage}
    />
  );

  function selectFilter(id) {
    setFilter(id);
    setPage(1);
  }

  // Patches the table's list (and, via the sync effect above, the open
  // details modal) after the admin attaches a document from Booking
  // Details — same shape the realtime handler would eventually deliver,
  // shown immediately instead of waiting on it.
  function handleDocumentUploaded(bookingId, documentType, documentPaths) {
    const patch = { identity_document_type: documentType, identity_document_urls: documentPaths };
    setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, ...patch } : b)));
    notifyAction('Document uploaded', 'success');
  }

  return (
    <div className="admin-panel">
      <ActionToast toast={actionToast} onClose={closeActionToast} />

      {onBack && (
        <button type="button" className="admin-back-link" onClick={onBack}>
          ← Back to Overview
        </button>
      )}

      <h2 className="admin-panel-heading">Booking Management</h2>

      <TabGroup className="filter-tabs" items={STATUS_FILTERS} activeId={filter} onSelect={selectFilter} />

      {actionError && <p className="error" role="alert">{actionError}</p>}
      {loading && <Loading />}

      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Camera</th>
            <th>Customer</th>
            <th>Qty</th>
            <th>Dates</th>
            <th>Details</th>
            {!isTerminalTab && <th>Change Status</th>}
          </tr>
        </thead>
        <tbody>
          {pagedBookings.map((b) => {
            const isOverdue = b.status === 'active' && b.end_date < todayISO();
            const dueAmount = isOverdue
              ? daysOverdue(b.end_date) * (b.cameras?.price ?? 0) * (b.quantity ?? 1)
              : 0;
            // Pickup date has come and gone but nobody tapped "Mark handed
            // over" yet — Active/Completed are manual now (see
            // 20260911000000_manual_pickup_return.sql), so this is the only
            // signal that catches a no-show instead of it sitting unnoticed.
            const isPickupOverdue =
              b.status === 'confirmed' &&
              b.payment_status !== 'pending' &&
              b.start_date < todayISO();

            const stockInfo = availability[b.id];
            const stockBlocked = stockInfo?.ok === false;
            const stockWarning = stockBlocked && (
              <span className="status-stock-warn" role="alert">
                {stockInfo.free} of {stockInfo.needed} unit{stockInfo.needed === 1 ? '' : 's'} free
                for these dates — cancel or free up another booking first.
              </span>
            );

            return (
              <tr key={b.id}>
                <td>
                  {b.cameras?.name ?? 'Unknown camera'}
                  {b.is_admin_hold && <span className="admin-hold-badge">Admin hold</span>}
                </td>
                <td>{b.customer_name || '—'}</td>
                <td>{b.quantity ?? 1}</td>
                <td>{formatDate(b.start_date)} → {formatDate(b.end_date)}</td>
                <td>
                  <button type="button" className="view-details-link" onClick={() => setDetailsBooking(b)}>
                    View Details
                  </button>
                </td>
                {!isTerminalTab && (
                <td>
                <div className="status-cell-inner">
                  {isOverdue && (
                    <div className="status-badges">
                      <span className="status-pill status-pill-overdue">Overdue</span>
                      <span className="status-pill status-pill-due">{formatPrice(dueAmount)} due</span>
                    </div>
                  )}
                  {isPickupOverdue && (
                    <div className="status-badges">
                      <span className="status-pill status-pill-overdue">
                        Pickup overdue — {daysOverdue(b.start_date)} day{daysOverdue(b.start_date) === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}

                  {b.status === 'confirmed' && (
                    <div className="status-actions">
                      <button
                        type="button"
                        className="status-action-primary status-action-activate"
                        disabled={stockBlocked || b.payment_status === 'pending'}
                        title={
                          b.payment_status === 'pending'
                            ? 'This is an unpaid hold — it will be released automatically if not paid.'
                            : stockBlocked
                              ? STOCK_UNAVAILABLE_ADMIN_MESSAGE
                              : undefined
                        }
                        onClick={() => {
                          setPickupCodeInput('');
                          setPendingAction({
                            rpcName: 'activate_booking',
                            bookingId: b.id,
                            question: 'Confirm this camera has been handed over?',
                            isAdminHold: b.is_admin_hold,
                          });
                        }}
                      >
                      Mark handed over
                      </button>
                      <button
                        type="button"
                        className="status-action-secondary"
                        onClick={() =>
                          setPendingAction({
                            rpcName: 'cancel_booking',
                            bookingId: b.id,
                            question: CANCEL_QUESTION,
                          })
                        }
                      >
                        Cancel
                      </button>
                      {stockWarning}
                    </div>
                  )}

                  {b.status === 'active' && (
                    <div className="status-actions">
                      <button
                        type="button"
                        className="status-action-primary status-action-complete"
                        onClick={() =>
                          setPendingAction({
                            rpcName: 'complete_booking',
                            bookingId: b.id,
                            question: 'Confirm this camera has been returned?',
                          })
                        }
                      >
                        Mark returned
                      </button>
                    </div>
                  )}
                </div>
                </td>
                )}
              </tr>
            );
          })}
          {!loading && bookings.length === 0 && (
            <tr>
              <td colSpan={isTerminalTab ? 5 : 6}>{filter === 'all' ? 'No bookings.' : `No ${filter} bookings.`}</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {paginationControl}

      {pendingAction && (
        <ConfirmDialog
          confirmClassName="status-action-primary status-action-activate"
          title={pendingAction.question}
          description="This updates the booking's status right away."
          confirmLabel="Confirm"
          confirmBusyLabel="Updating…"
          busy={confirming}
          onConfirm={confirmPendingAction}
          onCancel={() => {
            setPendingAction(null);
            setPickupCodeInput('');
          }}
        >
          {pendingAction.rpcName === 'activate_booking' && !pendingAction.isAdminHold && (
            <div className="pickup-code-field">
              <label htmlFor="pickup-code-input">
                Pickup code (ask the customer — it was emailed to them)
              </label>
              <input
                id="pickup-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pickupCodeInput}
                onChange={(e) => setPickupCodeInput(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                autoFocus
              />
              {actionError && <p className="error" role="alert">{actionError}</p>}
            </div>
          )}
          {pendingAction.rpcName === 'activate_booking' && pendingAction.isAdminHold && (
            <p className="pickup-code-field-note">Admin-created booking — no pickup verification needed.</p>
          )}
        </ConfirmDialog>
      )}

      {detailsBooking && (
        <BookingDetailsModal
          key={detailsBooking.id}
          booking={detailsBooking}
          onClose={() => setDetailsBooking(null)}
          onDocumentUploaded={handleDocumentUploaded}
        />
      )}
    </div>
  );
}
