
export function formatPrice(amount) {
  return `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// Browsers throw a bare "Failed to fetch" (no status, no server message) when
// a request never actually reaches the server — offline, a dropped
// connection, or a browser extension/antivirus blocking it — as opposed to a
// real Supabase/Postgrest error, which always carries its own descriptive
// message. Showing that raw string to a customer says nothing useful; this
// swaps it for something they can actually act on.
export function friendlyErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.message === 'Failed to fetch') {
    return "Couldn't reach the server — check your internet connection and try again.";
  }
  return err?.message || fallback;
}
