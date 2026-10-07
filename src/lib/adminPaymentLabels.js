// Admin-facing payment_status wording — shared by AdminPanel.jsx's table
// and BookingDetailsModal.jsx, so both agree on the same phrasing. Distinct
// from MyBookingsPage.jsx's own PAYMENT_LABELS, which is customer-facing
// and intentionally worded differently (e.g. "Hold — unpaid" here reads as
// "Payment pending" there).
export const ADMIN_PAYMENT_LABELS = {
  pending: 'Hold — unpaid',
  advance_paid: 'Advance paid',
  paid: 'Paid in full',
  expired: 'Hold expired',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};
