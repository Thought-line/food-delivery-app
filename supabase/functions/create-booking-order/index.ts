// POST { items?: [{camera_id,start_date,end_date,quantity}], item?: {...},
//        payment_option: 'advance'|'full', name, location, phone }
//
// 1. Prices every item from cameras.price in the DB (never trusts a client amount).
// 2. Creates a 15-minute hold per item via create_booking_hold(), run as the
//    caller (user-scoped client) so auth.uid() is the real customer. The stock
//    trigger rejects overlaps here — those items come back in `failures`.
// 3. Creates ONE Razorpay order for the summed amount due and records
//    payments + payment_bookings (with each booking's allocated share).
//
// Returns { order_id, amount, currency, razorpay_key_id, booking_ids, failures }.
// 409 { error:'unavailable', failures } when every item failed to hold.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { computeTotals, paiseToRupees } from '../_shared/pricing.ts';
import { createOrder, razorpayKeyId, RazorpayOrder } from '../_shared/razorpay.ts';

interface ItemInput {
  camera_id: string;
  start_date: string;
  end_date: string;
  quantity: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return jsonResponse({ error: 'not signed in' }, 401);

    const body = await req.json();
    const items: ItemInput[] = Array.isArray(body.items)
      ? body.items
      : body.item
        ? [body.item]
        : [];
    const paymentOption: 'advance' | 'full' = body.payment_option === 'advance' ? 'advance' : 'full';
    const contact = {
      name: String(body.name ?? '').trim(),
      location: String(body.location ?? '').trim(),
      phone: String(body.phone ?? '').trim(),
    };

    if (items.length === 0) return jsonResponse({ error: 'no items' }, 400);
    if (!contact.name || !contact.location || !contact.phone) {
      return jsonResponse({ error: 'missing contact details' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'not signed in' }, 401);

    const held: { booking_id: string; allocated_paise: number }[] = [];
    const failures: { camera_id: string; message: string }[] = [];
    let grandDuePaise = 0;

    for (const item of items) {
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

      const { data: cam, error: camErr } = await svc
        .from('cameras')
        .select('id, price, status')
        .eq('id', item.camera_id)
        .single();
      if (camErr || !cam || cam.status !== 'active') {
        failures.push({ camera_id: item.camera_id, message: 'camera not available' });
        continue;
      }

      const totals = computeTotals(Number(cam.price), qty, item.start_date, item.end_date);
      const duePaise = paymentOption === 'advance' ? totals.advancePaise : totals.totalPaise;

      const { data: bookingId, error: holdErr } = await userClient.rpc('create_booking_hold', {
        p_camera_id: item.camera_id,
        p_start: item.start_date,
        p_end: item.end_date,
        p_name: contact.name,
        p_location: contact.location,
        p_phone: contact.phone,
        p_quantity: qty,
        p_amount_total: paiseToRupees(totals.totalPaise),
      });

      if (holdErr || !bookingId) {
        const msg = /no_overlapping_confirmed_bookings/.test(holdErr?.message ?? '')
          ? 'those dates are no longer available'
          : holdErr?.message ?? 'could not hold this booking';
        failures.push({ camera_id: item.camera_id, message: msg });
        continue;
      }

      held.push({ booking_id: bookingId as string, allocated_paise: duePaise });
      grandDuePaise += duePaise;
    }

    if (held.length === 0) {
      return jsonResponse({ error: 'unavailable', failures }, 409);
    }

    const releaseHeld = async () => {
      await svc
        .from('bookings')
        .update({ status: 'cancelled', payment_status: 'expired', hold_expires_at: null })
        .in('id', held.map((h) => h.booking_id))
        .eq('payment_status', 'pending');
    };

    let order: RazorpayOrder;
    try {
      order = await createOrder({
        amountPaise: grandDuePaise,
        receipt: `bk_${held[0].booking_id.slice(0, 30)}`,
        notes: { customer_id: userData.user.id, payment_option: paymentOption },
      });
    } catch (orderErr) {
      await releaseHeld(); // don't leave holds sitting for 15 min if the order never got made
      throw orderErr;
    }

    const { data: payment, error: payErr } = await svc
      .from('payments')
      .insert({
        provider: 'razorpay',
        provider_order_id: order.id,
        payment_type: paymentOption === 'advance' ? 'advance' : 'full',
        amount: paiseToRupees(grandDuePaise),
        currency: 'INR',
        status: 'created',
      })
      .select('id')
      .single();
    if (payErr) {
      await releaseHeld();
      throw new Error(`payments insert: ${payErr.message}`);
    }

    const { error: linkErr } = await svc.from('payment_bookings').insert(
      held.map((h) => ({
        payment_id: payment.id,
        booking_id: h.booking_id,
        allocated_amount: paiseToRupees(h.allocated_paise),
      })),
    );
    if (linkErr) {
      await releaseHeld();
      throw new Error(`payment_bookings insert: ${linkErr.message}`);
    }

    return jsonResponse({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      razorpay_key_id: razorpayKeyId(),
      booking_ids: held.map((h) => h.booking_id),
      failures,
      payment_option: paymentOption,
    });
  } catch (err) {
    console.error('create-booking-order', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
