import { supabase } from './supabaseClient';
import { toISODate, isoToLocalDate, addDaysISO } from './dateUtils';
import { getCameraPhotoUrl } from './cameraPhotos';

// Data layer for the Revenue Analytics page (src/pages/RevenueAnalyticsPage.jsx).
//
// Revenue definition used throughout this file: a booking counts as revenue
// when amount_paid > 0. That single filter naturally excludes requested/
// rejected/cancelled-unpaid bookings (all have amount_paid = 0) and admin
// "maintenance" holds (always 0), while correctly *including* admin "person"
// (walk-in) holds that collected real money outside Razorpay — that's
// genuine business revenue, just not online-payment revenue. amount_paid is
// gross collected, never netted against a later refund (payments
// .refunded_amount isn't reconciled back onto the booking row) — same
// characteristic the existing admin_period_stats RPC already has, so this
// page's numbers stay consistent with the Overview card that links here.
//
// Period scoping uses bookings.created_at (booking-made date), matching
// admin_period_stats's own convention — not start_date (rental date).

export const PERIODS = ['day', 'month', 'year'];
export const PERIOD_LABELS = { day: 'Daily', month: 'Monthly', year: 'Yearly' };

const REVENUE_COLUMNS =
  'id, camera_id, customer_id, customer_name, start_date, end_date, created_at, status, payment_status, amount_paid, amount_total, quantity, cameras(name, price, photos, image_url)';

export async function fetchRevenueBookings({ startISO, endISO }) {
  const { data, error } = await supabase
    .from('bookings')
    .select(REVENUE_COLUMNS)
    .gt('amount_paid', 0)
    .gte('created_at', startISO)
    .lt('created_at', endISO)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Lightweight variant for the previous-period comparison — only the one
// column the delta needs, no joins.
export async function fetchPeriodRevenueTotal({ startISO, endISO }) {
  const { data, error } = await supabase
    .from('bookings')
    .select('amount_paid')
    .gt('amount_paid', 0)
    .gte('created_at', startISO)
    .lt('created_at', endISO);
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount_paid || 0), 0);
}

function startOfWeekISO(iso) {
  const d = isoToLocalDate(iso);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

function startOfMonthISO(iso) {
  const d = isoToLocalDate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function startOfYearISO(iso) {
  const d = isoToLocalDate(iso);
  return toISODate(new Date(d.getFullYear(), 0, 1));
}

function addMonthsISO(iso, months) {
  const d = isoToLocalDate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

function dayLabel(iso) {
  return isoToLocalDate(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function shortDayLabel(iso) {
  return isoToLocalDate(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function monthLabel(iso) {
  return isoToLocalDate(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function shortMonthLabel(iso) {
  return isoToLocalDate(iso).toLocaleDateString('en-IN', { month: 'short' });
}

// { startISO, endISO } is a half-open [start, end) window; `label` is the
// human-readable range shown next to the date-nav stepper.
export function getPeriodWindow(period, anchorISO) {
  if (period === 'day') {
    return { startISO: anchorISO, endISO: addDaysISO(anchorISO, 1), label: dayLabel(anchorISO) };
  }
  if (period === 'week') {
    const start = startOfWeekISO(anchorISO);
    const end = addDaysISO(start, 7);
    return { startISO: start, endISO: end, label: `${shortDayLabel(start)} – ${dayLabel(addDaysISO(end, -1))}` };
  }
  if (period === 'month') {
    const start = startOfMonthISO(anchorISO);
    const end = addMonthsISO(start, 1);
    return { startISO: start, endISO: end, label: monthLabel(start) };
  }
  // year
  const start = startOfYearISO(anchorISO);
  const end = toISODate(new Date(isoToLocalDate(start).getFullYear() + 1, 0, 1));
  return { startISO: start, endISO: end, label: String(isoToLocalDate(start).getFullYear()) };
}

// Shifts the anchor date by one whole period in `dir` (+1/-1) — same
// prev/next stepper contract AdminStats.jsx already uses, generalized to 4
// granularities.
export function shiftAnchor(period, anchorISO, dir) {
  const d = isoToLocalDate(anchorISO);
  if (period === 'day') d.setDate(d.getDate() + dir);
  else if (period === 'week') d.setDate(d.getDate() + dir * 7);
  else if (period === 'month') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  return toISODate(d);
}

// The window immediately preceding `window` of the same length — used for
// the previous-period revenue comparison.
export function getPreviousWindow(period, anchorISO) {
  const prevAnchor = shiftAnchor(period, anchorISO, -1);
  return getPeriodWindow(period, prevAnchor);
}

// How many trailing periods the Revenue Overview chart compares for each
// granularity — e.g. "Weekly" shows the last 8 weeks side by side, not one
// week broken into days. 'day' isn't listed: it stays an hour-by-hour
// breakdown of the single selected day (see bucketRevenue below), a
// genuinely different, still-useful view (today's intraday pattern) rather
// than a "last 14 days" trend.
export const CHART_TREND_COUNT = { week: 8, month: 12, year: 5 };

// The combined window spanning `count` whole periods, ending with (and
// including) the one at anchorISO — e.g. for period='month', anchor=Sep
// 2026, count=12: Oct 2025 through the end of Sep 2026. Used to fetch every
// booking the trend chart needs in a single query.
export function getTrendWindow(period, anchorISO, count) {
  let firstAnchor = anchorISO;
  for (let i = 0; i < count - 1; i++) firstAnchor = shiftAnchor(period, firstAnchor, -1);
  return { startISO: getPeriodWindow(period, firstAnchor).startISO, endISO: getPeriodWindow(period, anchorISO).endISO };
}

function hourLabel(hour) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? 'am' : 'pm'}`;
}

// Buckets `bookings` (already scoped to `window`) into chart points, sized
// to the period: 24 hourly buckets for a day, one bucket per day for a
// week/month, one per month for a year. All bucketing uses each booking's
// LOCAL calendar day/hour (derived from created_at via the Date object, not
// a naive string slice) so it lines up with how the browser displays dates
// elsewhere in the app.
export function bucketRevenue(bookings, period, window) {
  if (period === 'day') {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), revenue: 0 }));
    for (const b of bookings) {
      const hour = new Date(b.created_at).getHours();
      buckets[hour].revenue += Number(b.amount_paid || 0);
    }
    return buckets;
  }

  if (period === 'week' || period === 'month') {
    const days = [];
    for (let iso = window.startISO; iso < window.endISO; iso = addDaysISO(iso, 1)) days.push(iso);
    const index = new Map(days.map((iso, i) => [iso, i]));
    const buckets = days.map((iso) => ({ label: shortDayLabel(iso), revenue: 0 }));
    for (const b of bookings) {
      const iso = toISODate(new Date(b.created_at));
      const i = index.get(iso);
      if (i != null) buckets[i].revenue += Number(b.amount_paid || 0);
    }
    return buckets;
  }

  // year -> by month
  const months = [];
  for (let iso = window.startISO; iso < window.endISO; iso = addMonthsISO(iso, 1)) months.push(iso);
  const index = new Map(months.map((iso, i) => [iso, i]));
  const buckets = months.map((iso) => ({ label: shortMonthLabel(iso), revenue: 0 }));
  for (const b of bookings) {
    const created = new Date(b.created_at);
    const key = toISODate(new Date(created.getFullYear(), created.getMonth(), 1));
    const i = index.get(key);
    if (i != null) buckets[i].revenue += Number(b.amount_paid || 0);
  }
  return buckets;
}

// Compares `count` whole periods against each other — e.g. period='week'
// buckets `bookings` (already scoped to the combined trend window from
// getTrendWindow) into one point per week, oldest first, ending at
// anchorISO's own week. Distinct from bucketRevenue above, which breaks a
// single period down into its sub-units (a week into its 7 days); this
// breaks a *span* of periods down into one point per whole period.
export function bucketRevenueTrend(bookings, period, anchorISO, count) {
  const windows = [];
  let a = anchorISO;
  for (let i = 0; i < count; i++) {
    windows.unshift(getPeriodWindow(period, a));
    a = shiftAnchor(period, a, -1);
  }
  return windows.map((w) => {
    const startMs = isoToLocalDate(w.startISO).getTime();
    const endMs = isoToLocalDate(w.endISO).getTime();
    const revenue = bookings.reduce((sum, b) => {
      const t = new Date(b.created_at).getTime();
      return t >= startMs && t < endMs ? sum + Number(b.amount_paid || 0) : sum;
    }, 0);
    return { label: w.label, revenue };
  });
}

// Narrows an already-fetched (wider) set of bookings down to just the ones
// inside `window` — used when the chart's trend fetch spans several periods
// but the KPI/camera/breakdown/transactions sections need only the current
// (last) one, so a second query isn't needed just to re-scope the same data.
export function filterBookingsInWindow(bookings, window) {
  const startMs = isoToLocalDate(window.startISO).getTime();
  const endMs = isoToLocalDate(window.endISO).getTime();
  return bookings.filter((b) => {
    const t = new Date(b.created_at).getTime();
    return t >= startMs && t < endMs;
  });
}

// Per-camera revenue — no existing query does this anywhere in the app.
export function aggregateByCamera(bookings) {
  const map = new Map();
  let total = 0;
  for (const b of bookings) {
    const amt = Number(b.amount_paid || 0);
    total += amt;
    if (!map.has(b.camera_id)) {
      map.set(b.camera_id, {
        cameraId: b.camera_id,
        name: b.cameras?.name ?? 'Unknown camera',
        photo: getCameraPhotoUrl(b.cameras ?? {}),
        bookingCount: 0,
        revenue: 0,
      });
    }
    const entry = map.get(b.camera_id);
    entry.bookingCount += 1;
    entry.revenue += amt;
  }
  const list = Array.from(map.values());
  for (const entry of list) entry.pctOfTotal = total > 0 ? (entry.revenue / total) * 100 : 0;
  list.sort((a, b) => b.revenue - a.revenue);
  return list;
}

// Revenue by payment_status — the real, persisted substitute for "Completed
// Rentals / Late Fees / Other Charges": no distinct fee/charge dollar amount
// is ever stored anywhere in this schema (only computed transiently, once,
// by cancel_my_booking()'s response — never written to a column), so a
// breakdown by what actually IS stored (payment_status) is the honest
// option. Only groups with real revenue > 0 are returned — never a
// fabricated zero slice.
const STATUS_GROUPS = [
  { key: 'paid', label: 'Full Payment', match: (s) => s === 'paid' },
  { key: 'advance_paid', label: 'Advance Payment', match: (s) => s === 'advance_paid' },
  { key: 'refunded', label: 'Refunded', match: (s) => s === 'refund_pending' || s === 'refunded' },
];

export function aggregateByPaymentStatus(bookings) {
  let total = 0;
  const sums = STATUS_GROUPS.map((g) => ({ ...g, revenue: 0 }));
  for (const b of bookings) {
    const amt = Number(b.amount_paid || 0);
    total += amt;
    const group = sums.find((g) => g.match(b.payment_status));
    if (group) group.revenue += amt;
  }
  return sums
    .filter((g) => g.revenue > 0)
    .map(({ key, label, revenue }) => ({ key, label, revenue, pct: total > 0 ? (revenue / total) * 100 : 0 }));
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildTransactionsCsv(bookings) {
  const header = ['Booking ID', 'Camera', 'Customer', 'Rental Period', 'Amount', 'Status'];
  const rows = bookings.map((b) => [
    b.id,
    b.cameras?.name ?? '',
    b.customer_name ?? '',
    `${b.start_date} to ${b.end_date}`,
    b.amount_paid,
    b.payment_status,
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}
