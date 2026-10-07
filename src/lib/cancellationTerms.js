// Tiered, time-based cancellation fee policy — a client-side PREVIEW only.
// The real fee is always recomputed server-side, inside cancel_my_booking()
// (see supabase/migrations/20260916000000_tiered_cancellation_fee.sql), using
// the database's own clock and the booking's stored created_at/amount_paid —
// this function's result is never sent to the server, so there's nothing to
// "trust" from the client in the first place.
//
// Policy:
//   - Grace period: within 2 hours of the booking being made, 0% fee, no
//     questions asked, regardless of how close the rental start date is.
//     This always wins over the tier table below.
//   - Otherwise, by whole days remaining until the rental start date:
//       7+ days   -> 0%   (full refund)
//       3-6 days  -> 10%
//       1-2 days  -> 25%
//       0 or fewer (started) -> 100% (non-refundable)

export const GRACE_PERIOD_MS = 2 * 60 * 60 * 1000; // 2 hours

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Checked in order, first match wins — so this must stay sorted by minDays
// descending.
const FEE_TIERS = [
  { minDays: 7, feePercent: 0 },
  { minDays: 3, feePercent: 10 },
  { minDays: 1, feePercent: 25 },
  { minDays: -Infinity, feePercent: 100 },
];

function feePercentForDays(daysUntilStart) {
  return FEE_TIERS.find((tier) => daysUntilStart >= tier.minDays).feePercent;
}

/**
 * @param {{ createdAt: string | Date, startDate: string | Date, amountPaid: number }} booking
 * @param {Date} now
 * @returns {{ isGracePeriod: boolean, daysUntilStart: number, feePercent: number, fee: number, refund: number }}
 */
export function getCancellationTerms(booking, now) {
  const { createdAt, startDate, amountPaid } = booking;
  const nowMs = now.getTime();
  const createdMs = new Date(createdAt).getTime();
  const startMs = new Date(startDate).getTime();

  const isGracePeriod = nowMs - createdMs <= GRACE_PERIOD_MS;
  const daysUntilStart = Math.floor((startMs - nowMs) / MS_PER_DAY);
  const feePercent = isGracePeriod ? 0 : feePercentForDays(daysUntilStart);

  const fee = Math.round((feePercent / 100) * amountPaid);
  const refund = amountPaid - fee;

  return { isGracePeriod, daysUntilStart, feePercent, fee, refund };
}
