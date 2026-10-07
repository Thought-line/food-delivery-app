// "Pay balance" button in My Bookings. Creates a Razorpay order for the
// outstanding amount on a booking the caller owns that is in advance_paid.
// verify-payment / the webhook then settle it and flip it to 'paid'.
//
// POST { booking_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createOrder, razorpayKeyId } from '../_shared/razorpay.ts';
import { paiseToRupees } from '../_shared/pricing.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return jsonResponse({ error: 'not signed in' }, 401);

    const { booking_id } = await req.json();
    if (!booking_id) return jsonResponse({ error: 'missing booking_id' }, 400);

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: user } = await userClient.auth.getUser();
    if (!user?.user) return jsonResponse({ error: 'not signed in' }, 401);

    // RLS (bookings_select_own) scopes this to the caller's own booking.
    const { data: booking, error } = await userClient
      .from('bookings')
      .select('id, payment_status, amount_total, amount_paid')
      .eq('id', booking_id)
      .single();
    if (error || !booking) return jsonResponse({ error: 'booking not found' }, 404);
    if (booking.payment_status !== 'advance_paid') {
      return jsonResponse({ error: 'no balance due on this booking' }, 400);
    }

    const balancePaise = Math.round(
      (Number(booking.amount_total) - Number(booking.amount_paid)) * 100,
    );
    if (balancePaise <= 0) return jsonResponse({ error: 'nothing left to pay' }, 400);

    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false },
    });

    const order = await createOrder({
      amountPaise: balancePaise,
      receipt: `bal_${booking_id.slice(0, 30)}`,
      notes: { booking_id, kind: 'balance' },
    });

    const { data: payment, error: payErr } = await svc
      .from('payments')
      .insert({
        provider: 'razorpay',
        provider_order_id: order.id,
        payment_type: 'balance',
        amount: paiseToRupees(balancePaise),
        currency: 'INR',
        status: 'created',
      })
      .select('id')
      .single();
    if (payErr) throw new Error(payErr.message);

    const { error: linkErr } = await svc.from('payment_bookings').insert({
      payment_id: payment.id,
      booking_id,
      allocated_amount: paiseToRupees(balancePaise),
    });
    if (linkErr) throw new Error(linkErr.message);

    return jsonResponse({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      razorpay_key_id: razorpayKeyId(),
      booking_ids: [booking_id],
    });
  } catch (err) {
    console.error('create-balance-order', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
