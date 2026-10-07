import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './useAuth';
import { formatDate } from './dateUtils';
import { BookingNotificationsContext } from './bookingNotificationsState';
const STATUS_COPY = {
  confirmed: { title: 'Booking Confirmed!', verb: 'confirmed', type: 'success' },
  active: { title: 'Booking Active!', verb: 'activated', type: 'success' },
  completed: { title: 'Booking Completed!', verb: 'completed', type: 'success' },
  rejected: { title: 'Booking Declined', verb: 'declined', type: 'warning' },
  cancelled: { title: 'Booking Cancelled', verb: 'cancelled', type: 'warning' },
};

// An unpaid hold that expires (or gets dismissed) also lands on
// status='cancelled' — see expire_booking_holds() / cancel_unpaid_hold() —
// but nothing was ever actually booked, so "Booking Cancelled" is the wrong
// framing. payment_status='expired' is exactly that case; give it its own
// copy instead of STATUS_COPY.cancelled.
const UNPAID_HOLD_COPY = { title: 'Booking Not Confirmed', type: 'warning' };
export function BookingNotificationsProvider({ children }) {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnseenCount(0);
      return undefined;
    }
    let cancelled = false;
    let channel = null;
    const knownStatus = new Map();

    async function start() {
      const { data } = await supabase.from('bookings').select('id, status').eq('customer_id', user.id);
      if (cancelled) return;
      if (data) {
        for (const row of data) knownStatus.set(row.id, row.status);
      }

      channel = supabase
        .channel(`booking-notifications-${user.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `customer_id=eq.${user.id}` },
          async (payload) => {
            const nextStatus = payload.new.status;
            const prevStatus = knownStatus.get(payload.new.id);
            knownStatus.set(payload.new.id, nextStatus);

            const isUnpaidHoldRelease = nextStatus === 'cancelled' && payload.new.payment_status === 'expired';
            const copy = isUnpaidHoldRelease ? UNPAID_HOLD_COPY : STATUS_COPY[nextStatus];
            if (!copy || nextStatus === prevStatus) return; // not a status change worth announcing

            const { data: camera } = await supabase
              .from('cameras')
              .select('name')
              .eq('id', payload.new.camera_id)
              .single();
            if (cancelled) return;

            const dates = `${formatDate(payload.new.start_date)} → ${formatDate(payload.new.end_date)}`;
            const message = isUnpaidHoldRelease
              ? `Your booking for ${camera?.name ?? 'your camera'} (${dates}) was not confirmed — payment wasn't completed in time.`
              : `Your booking for ${camera?.name ?? 'your camera'} (${dates}) has been ${copy.verb}.`;
            // Appended, not replaced — see the `events` doc comment above.
            setEvents((prev) => [
              ...prev,
              {
                id: `${payload.new.id}-${nextStatus}-${Date.now()}`,
                type: copy.type,
                title: copy.title,
                message,
              },
            ]);
            setUnseenCount((count) => count + 1);
          }
        )
        .subscribe((status) => {
          // Surfaces a silent connection failure (e.g. the `bookings` table
          // not being in the project's realtime publication) instead of
          // notifications just never arriving with no clue why.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('BookingNotificationsProvider: realtime subscription failed to connect —', status);
          }
        });
    }

    start();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user]);

  const markSeen = useCallback(() => setUnseenCount(0), []);

  // Called once a toast's own exit animation finishes (or it's clicked
  // through to My Bookings) — drops just that one card from the stack.
  const dismissEvent = useCallback((id) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const value = useMemo(
    () => ({ events, unseenCount, markSeen, dismissEvent }),
    [events, unseenCount, markSeen, dismissEvent]
  );

  return (
    <BookingNotificationsContext.Provider value={value}>{children}</BookingNotificationsContext.Provider>
  );
}
