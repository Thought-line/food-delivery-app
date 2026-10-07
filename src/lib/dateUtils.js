// Shared date helpers for plain 'YYYY-MM-DD' date strings, used across
// booking/availability/camera-search screens.

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Converts a local Date object (e.g. from DateRangePicker) to 'YYYY-MM-DD'.
// Deliberately NOT `date.toISOString().slice(0, 10)` — that converts to UTC
// first, which can shift the calendar date by a day depending on the
// browser's timezone offset. This reads the date's local fields instead.
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The inverse of toISODate — turns a 'YYYY-MM-DD' string back into a local
// Date (midnight local time), e.g. to seed DateRangePicker from a stored or
// URL-carried date. Deliberately not `new Date(iso)`, which Date parses as
// UTC midnight and can display as the previous day in timezones behind UTC.
export function isoToLocalDate(iso) {
  return new Date(iso + 'T00:00:00');
}

export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  // toISODate reads the Date's local fields directly — NOT
  // `d.toISOString().slice(0, 10)`, which converts to UTC first. For any
  // timezone ahead of UTC (e.g. IST, what this whole app runs on), that
  // shifts local midnight back into the previous UTC day, so this could
  // return the SAME date it was given instead of the next one. Harmless
  // for a one-off call, but fatal in a loop that steps by calling this
  // repeatedly (see findShortDates in availability.js) — the loop variable
  // gets stuck on the same value forever, an actual infinite loop that
  // freezes the tab.
  return toISODate(d);
}

// Whole days between end_date and today — 0 if not overdue.
export function daysOverdue(endDate) {
  const ms = new Date(todayISO() + 'T00:00:00') - new Date(endDate + 'T00:00:00');
  return Math.max(0, Math.round(ms / 86400000));
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
  });
}
// Exact date + time for a full timestamp (e.g. bookings.created_at) —
// unlike the rest of this file, which works with plain 'YYYY-MM-DD' dates,
// this takes a real timestamptz. Used so a newest-first list (e.g. the
// admin's booking queue) still shows precisely when each request came in,
// letting the admin tell which came first without relying on a fuzzy
// "2h ago"-style label that hides the actual order between close requests.
export function formatDateTime(isoTimestamp) {
  if (!isoTimestamp) return '';
  const d = new Date(isoTimestamp);
  const date = d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

export function formatDateHint(iso) {
  if (!iso) return '';
  const label = new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (iso === todayISO()) return `${label} (Today)`;
  if (iso === addDaysISO(todayISO(), 1)) return `${label} (Tomorrow)`;
  return label;
}   

