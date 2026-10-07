import { supabase } from './supabaseClient';

// All reviews for one camera, newest first — shown on CameraDetailsPage.
// Public read (see reviews_public_read policy), so this works for anon too.
export async function fetchReviewsForCamera(cameraId) {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, created_at, customer_name')
    .eq('camera_id', cameraId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function submitReview(bookingId, rating, comment) {
  const { data, error } = await supabase.rpc('submit_review', {
    p_booking_id: bookingId,
    p_rating: rating,
    p_comment: comment,
  });
  if (error) throw error;
  return data;
}

export async function dismissReviewPrompt(bookingId) {
  const { error } = await supabase.rpc('dismiss_review_prompt', { p_booking_id: bookingId });
  if (error) throw error;
}

// PostgREST embeds a `bookings.select('..., reviews(...)')` relation as an
// array — EXCEPT `reviews.booking_id` is `unique`, so it can also come back
// as a single object (or null) once one exists, since it detects that as a
// to-one relationship. `.length` on that object is `undefined`, so a naive
// `reviews.length > 0` check silently reads an already-reviewed booking as
// unreviewed. Normalize both shapes here instead of duplicating this in
// every place that checks "has this booking been reviewed yet?".
export function embeddedReview(bookingRow) {
  const r = bookingRow.reviews;
  if (!r) return null;
  return Array.isArray(r) ? r[0] ?? null : r;
}

// How long to wait before showing the review prompt again after "Maybe
// Later", and how many times it's allowed to come back before giving up.
export const REVIEW_PROMPT_COOLDOWN_DAYS = 3;
export const REVIEW_PROMPT_MAX_REMINDERS = 2;

// Pure so ReviewPromptProvider can just filter with it. `booking` needs
// review_prompt_dismiss_count / review_prompt_dismissed_at (raw column
// names, straight off the bookings row).
export function isReviewPromptDue(booking) {
  const count = booking.review_prompt_dismiss_count ?? 0;
  if (count === 0) return true; // never dismissed — show it
  if (count > REVIEW_PROMPT_MAX_REMINDERS) return false; // reminded enough, stop
  if (!booking.review_prompt_dismissed_at) return true;
  const daysSince = (Date.now() - new Date(booking.review_prompt_dismissed_at).getTime()) / 86400000;
  return daysSince >= REVIEW_PROMPT_COOLDOWN_DAYS;
}
