// Customer "Cancel booking" action (MyBookingsPage.jsx). Cancels a booking
// that hasn't been picked up yet via cancel_my_booking() — a SECURITY
// DEFINER RPC that checks the caller owns the booking and that it's still
// 'confirmed' — then, for any captured payment, attempts a Razorpay refund
// and emails the customer either way. Mirrors retire-camera's refund flow.
//
// POST { bookingId }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { refundPayment } from '../_shared/razorpay.ts';
import { sendStatusEmail } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return jsonResponse({ error: 'not signed in' }, 401);

    const { bookingId } = await req.json();
    if (!bookingId) return jsonResponse({ error: 'missing bookingId' }, 400);

    const url = Deno.env.get('SUPABASE_URL') ?? '';

    // Forward the caller's JWT so cancel_my_booking's own ownership check
    // (auth.uid() -> bookings.customer_id) is what gates this, not this function.
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data, error } = await userClient.rpc('cancel_my_booking', { p_booking_id: bookingId });
    if (error) return jsonResponse({ error: error.message }, 400);

    const refundDue = data?.refund_due ?? [];

    // Service role from here on — issuing refunds and emailing the customer
    // regardless of who's logged in when this runs.
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false },
    });

    let refundedCount = 0;
    if (refundDue.length === 0) {
      await sendStatusEmail(svc, bookingId, 'cancelled', {});
    } else {
      for (const r of refundDue) {
        try {
          if (r.provider_payment_id) {
            const refund = await refundPayment(r.provider_payment_id, Math.round(r.amount * 100), {
              booking_id: r.booking_id,
              reason: 'customer_cancelled',
            });
            await svc.rpc('mark_payment_refunded', {
              p_provider_order_id: r.provider_order_id,
              p_provider_refund_id: refund.id ?? null,
              p_refund_amount: r.amount,
            });
            refundedCount++;
          } else {
            console.error('refund_due row has no provider_payment_id', r);
          }
        } catch (e) {
          // needs_refund is already flagged by cancel_my_booking — the admin
          // finishes this one from the Razorpay dashboard if the automatic
          // attempt didn't go through.
          console.error('auto-refund failed for booking', r.booking_id, e);
        }
        await sendStatusEmail(svc, r.booking_id, 'customer_cancelled_refund', { amount: r.amount, fee: r.fee });
      }
    }

    return jsonResponse({
      ok: true,
      refunded: refundedCount,
      refund_pending: refundDue.length - refundedCount,
    });
  } catch (err) {
    console.error('cancel-booking crashed', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
