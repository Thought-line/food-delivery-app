// Server-side money math for bookings. All arithmetic is in integer paise;
// rupees (numeric(10,2)) are only for what gets stored/displayed.
//
// rentalDays MUST match src/lib/rentalDays.js exactly (end date excluded, so
// Aug 10 -> Aug 12 bills 2 days) — it is also the same value Postgres gets from
// (end_date - start_date), which the create_booking_hold RPC stores independently.

export type PaymentOption = 'advance' | 'full';

export function rentalDays(startISO: string, endISO: string): number {
  const ms =
    new Date(endISO + 'T00:00:00Z').getTime() - new Date(startISO + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

export function computeTotals(
  pricePerDay: number,
  quantity: number,
  startISO: string,
  endISO: string,
) {
  const days = rentalDays(startISO, endISO);
  const totalPaise = Math.round(Number(pricePerDay) * 100) * quantity * days;
  const advancePaise = Math.ceil(totalPaise / 4); // 25%
  return { days, totalPaise, advancePaise, balancePaise: totalPaise - advancePaise };
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}
