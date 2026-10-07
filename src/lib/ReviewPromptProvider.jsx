import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './useAuth';
import { dismissReviewPrompt, isReviewPromptDue, embeddedReview } from './reviews';
import { ReviewPromptContext } from './reviewPromptState';

// Owns the "which completed booking should we nudge this customer to
// review right now" queue, and the one realtime subscription that keeps it
// fresh. Mounted once above the routes (see App.jsx), same reasoning as
// BookingNotificationsProvider: survives page navigation instead of
// reconnecting on every route change.
export function ReviewPromptProvider({ children }) {
  const { user } = useAuth();
  const [queue, setQueue] = useState([]);

  const loadQueue = useCallback(async () => {
    if (!user) {
      setQueue([]);
      return;
    }
    // The reverse-embed `reviews(id)` (reviews.booking_id -> bookings.id)
    // answers "already reviewed?" in the same round trip instead of a
    // second query per booking.
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, camera_id, start_date, end_date, review_prompt_dismiss_count, review_prompt_dismissed_at, cameras(name), reviews(id)'
      )
      .eq('customer_id', user.id)
      .eq('status', 'completed');

    if (error) {
      setQueue([]);
      return;
    }

    const due = (data ?? [])
      .filter((b) => !embeddedReview(b) && isReviewPromptDue(b))
      .map((b) => ({
        id: b.id,
        cameraName: b.cameras?.name ?? 'your camera',
        startDate: b.start_date,
        endDate: b.end_date,
      }));
    setQueue(due);
  }, [user]);

  useEffect(() => {
    loadQueue();
    if (!user) return undefined;

    // Same simple "something changed, refetch" style MyBookingsPage's own
    // channel already uses — no need to diff individual transitions here.
    // Also listens on `reviews` INSERTs (not just `bookings` changes) —
    // submitting a review only writes to `reviews`, never touches
    // `bookings`, so without this a review submitted from My Bookings
    // (instead of via this card's own "Write a Review") would leave the
    // queue stale and the card could nag about an already-reviewed booking.
    const channel = supabase
      .channel(`review-prompts-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${user.id}` },
        () => loadQueue()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reviews', filter: `customer_id=eq.${user.id}` },
        () => loadQueue()
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user, loadQueue]);

  // "Maybe Later" / the × — records the dismissal server-side (so the
  // reminder cooldown/cap is respected even across devices), then just
  // drops it locally; it'll reappear once loadQueue runs again and its
  // cooldown has elapsed.
  const dismiss = useCallback(async () => {
    const [current] = queue;
    if (!current) return;
    setQueue((q) => q.slice(1));
    try {
      await dismissReviewPrompt(current.id);
    } catch {
      // Non-critical — worst case the prompt shows again a little sooner
      // than intended next time the queue reloads.
    }
  }, [queue]);

  // Called after a successful submission — no need to wait for a refetch.
  const markReviewed = useCallback((bookingId) => {
    setQueue((q) => q.filter((b) => b.id !== bookingId));
  }, []);

  const value = useMemo(
    () => ({ current: queue[0] ?? null, dismiss, markReviewed }),
    [queue, dismiss, markReviewed]
  );

  return <ReviewPromptContext.Provider value={value}>{children}</ReviewPromptContext.Provider>;
}
