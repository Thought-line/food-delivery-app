import { useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './useAuth';
import { useActionToast } from './useActionToast';
import { AdminNotificationsContext } from './adminNotificationsState';

// Owns the one realtime subscription that watches ALL bookings, admin-wide,
// for a payment actually capturing — the admin-side equivalent of
// BookingNotificationsProvider, which only watches one customer's own rows.
// Mounted once above the routes (see App.jsx) and self-gates on role, so it
// keeps toasting new paid bookings even while the admin is on the Manage
// Camera tab, not just while AdminPanel itself is mounted.
export function AdminNotificationsProvider({ children }) {
  const { user, role } = useAuth();
  const isAdmin = Boolean(user) && role === 'admin';
  const { toast, notify, close } = useActionToast();

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    let channel = null;
    // Ids we've already counted as a "new booking" toast — a booking becomes
    // real when its payment is captured (payment_status -> advance_paid/paid),
    // not when the 15-minute hold is first inserted (most holds never pay).
    const notifiedPaidIds = new Set();
    const PAID = ['advance_paid', 'paid'];

    async function start() {
      const { data: paidRows } = await supabase.from('bookings').select('id').in('payment_status', PAID);
      if (cancelled) return;
      if (paidRows) {
        for (const row of paidRows) notifiedPaidIds.add(row.id);
      }

      const maybeNotifyPaid = (row) => {
        if (!row || !PAID.includes(row.payment_status) || notifiedPaidIds.has(row.id)) return;
        notifiedPaidIds.add(row.id);
        notify('New booking received', 'success');
      };

      channel = supabase
        .channel('admin-notifications')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'bookings' },
          (payload) => maybeNotifyPaid(payload.new)
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'bookings' },
          (payload) => maybeNotifyPaid(payload.new)
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('AdminNotificationsProvider: realtime subscription failed to connect —', status);
          }
        });
    }

    start();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  return (
    <AdminNotificationsContext.Provider value={{ toast, closeToast: close }}>
      {children}
    </AdminNotificationsContext.Provider>
  );
}
