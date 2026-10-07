import { supabase } from './supabaseClient';
import { addDaysISO, formatDate } from './dateUtils';

// Available units for ONE camera over a date range =
// stock_quantity − sum(quantity) of confirmed/active bookings that overlap it.
// The end date is inclusive: a booking overlaps when
// existingStart <= requestedEnd AND existingEnd >= requestedStart, so a
// booking held through the 15th blocks the 15th for everyone else.
//
// Routed through a SECURITY DEFINER RPC (not a direct `bookings` select) so
// this always sees every customer's bookings, not just the caller's own —
// see supabase/migrations/20260816000000_get_remaining_units_rpc.sql for why
// a plain client-side select would under-count and disagree with what the
// server actually enforces.
export async function getRemainingUnits(camera, startDate, endDate) {
  const { data, error } = await supabase.rpc('get_remaining_units', {
    p_camera_id: camera.id,
    p_start: startDate,
    p_end: endDate,
  });

  if (error) throw error;
  return data;
}

// Units already held (status confirmed/active) for one camera over a date
// range, optionally ignoring one booking. The admin panel asks "would
// confirming / activating THIS booking push the camera past its stock?" —
// passing the booking's own id as excludeBookingId keeps its row from
// counting against itself once it's already confirmed. Same privileged,
// RLS-immune RPC path as getRemainingUnits (see the note above).
export async function getCommittedUnits(cameraId, startDate, endDate, excludeBookingId = null) {
  const { data, error } = await supabase.rpc('get_committed_units', {
    p_camera_id: cameraId,
    p_start: startDate,
    p_end: endDate,
    p_exclude_booking_id: excludeBookingId,
  });

  if (error) throw error;
  return data;
}

// Bulk version for a whole camera list: returns { [camera_id]: totalBookedQuantity }
// for every camera with a confirmed/active booking overlapping the range.
// Used by CameraList.jsx instead of calling getRemainingUnits once per camera.
export async function getBookedQuantitiesByCamera(startDate, endDate) {
  const { data, error } = await supabase.rpc('get_booked_quantities_by_camera', {
    p_start: startDate,
    p_end: endDate,
  });

  if (error) throw error;

  const booked = {};
  for (const row of data ?? []) {
    booked[row.camera_id] = row.booked_quantity;
  }
  return booked;
}

// Turns one day's { stock, available } (from getCameraDailyAvailability) into
// the three-way status the calendars tint by — shared by the admin's
// AvailabilityCalendar.jsx and the customer-facing DateRangePicker.jsx
// (via BookingForm.jsx) so both read the exact same rule.
export function dayAvailabilityStatus(stock, available) {
  if (available <= 0) return 'full';
  if (available < stock) return 'partial';
  return 'available';
}

// Same three states, but relative to how many units the customer actually
// wants (not just "is anything left") — green only once there's enough for
// THEIR quantity, so the calendar recolors live as they change it.
export function quantityAwareDayStatus(available, requestedQuantity) {
  if (available <= 0) return 'full';
  if (available < requestedQuantity) return 'partial';
  return 'available';
}

// Per-day booked/available breakdown for ONE camera over a range — powers
// the admin's "View availability" calendar (AvailabilityCalendar.jsx). Unlike
// getRemainingUnits/getBookedQuantitiesByCamera (a single number for a whole
// range), this returns one row per day so the calendar can tint each day by
// how full it is. Same overlap semantics as the stock trigger, just per-day.
export async function getCameraDailyAvailability(cameraId, startDate, endDate) {
  const { data, error } = await supabase.rpc('get_camera_daily_availability', {
    p_camera_id: cameraId,
    p_start: startDate,
    p_end: endDate,
  });

  if (error) throw error;

  // { [isoDate]: { stock, booked, available } }
  const byDay = {};
  for (const row of data ?? []) {
    byDay[row.day] = { stock: row.stock, booked: row.booked, available: row.available };
  }
  return byDay;
}

// How many times each camera has actually been rented (confirmed/active/
// completed bookings — not requested-and-never-approved, rejected, or
// cancelled ones). Powers the "Trending" badge in CameraList.jsx. Same
// bulk-RPC shape as getBookedQuantitiesByCamera above, just not scoped to
// a date range since this is an all-time count, not availability.
export async function getCameraRentalCounts() {
  const { data, error } = await supabase.rpc('get_camera_rental_counts');

  if (error) throw error;

  const counts = {};
  for (const row of data ?? []) {
    counts[row.camera_id] = row.rental_count;
  }
  return counts;
}

// Pre-submit check across a FULL date range: which specific days (inclusive
// of both endpoints — matches the stock trigger's own overlap rule, see the
// getRemainingUnits note up top) don't have `quantity` units free, and
// exactly how many are actually left on each. getRemainingUnits alone only
// returns the range's single worst-case number; this is what lets the
// booking form name the actual short dates instead of a flat "not
// available" covering the whole range. Only meant to be called once
// getRemainingUnits has already flagged a shortfall — it costs a second RPC
// round-trip, so the happy path shouldn't pay for it.
export async function findShortDates(camera, startDate, endDate, quantity) {
  const dayData = await getCameraDailyAvailability(camera.id, startDate, endDate);
  const short = [];
  for (let iso = startDate; iso <= endDate; iso = addDaysISO(iso, 1)) {
    const d = dayData[iso];
    const available = d ? d.available : camera.stock_quantity;
    if (available < quantity) short.push({ date: iso, available });
  }
  return short;
}

// Turns findShortDates' result into the copy shown next to the form — names
// the actual short dates plus the exact units left on each, capped so a long
// run of short dates doesn't turn into an unreadable wall of text.
const MAX_LISTED_SHORT_DATES = 4;
export function formatShortDatesMessage(shortDates) {
  if (!shortDates?.length) return null;
  const listed = shortDates
    .slice(0, MAX_LISTED_SHORT_DATES)
    .map((d) => `${formatDate(d.date)} (${d.available} left)`)
    .join(', ');
  const extraCount = shortDates.length - MAX_LISTED_SHORT_DATES;
  const extra = extraCount > 0 ? `, and ${extraCount} more date${extraCount === 1 ? '' : 's'}` : '';
  return `Not enough stock on ${listed}${extra}. Please reduce the quantity or choose different dates.`;
}

// Shared, consistent copy + detection for the DB trigger's rejection
// (check_camera_stock_availability, see supabase/migrations), used wherever
// a create_booking_hold call can hit it.
export const STOCK_UNAVAILABLE_MESSAGE =
  'Maximum available quantity reached. Please reduce the quantity or choose different dates.';

// Same trigger rejection as STOCK_UNAVAILABLE_MESSAGE, but phrased for admin
// actions (Mark handed over, admin_block_camera) — they can't change the
// customer's quantity or dates from here, only cancel/free up another
// booking or pick different dates.
export const STOCK_UNAVAILABLE_ADMIN_MESSAGE =
  'Cannot proceed — another confirmed/active booking already uses all available units for these dates. Cancel or free up another booking, or choose different dates.';

export function isStockUnavailableError(error) {
  return Boolean(error?.message?.includes('no_overlapping_confirmed_bookings'));
}
