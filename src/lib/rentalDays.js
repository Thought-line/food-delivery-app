// Number of billable days for a rental spanning start_date -> end_date.
// end_date is the pickup/return day, not a day of use, so it's excluded —
// e.g. Aug 10 to Aug 12 bills 2 days.
export function rentalDays(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00');
  return Math.max(1, Math.round(ms / 86400000));
}
