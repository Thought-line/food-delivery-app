// Admin "Remove camera" action (CameraManager.jsx). Retires the camera and
// cancels any live booking on it via admin_retire_camera() — a SECURITY
// DEFINER RPC that does its own admin-role check — then, for any cancelled
// booking with a captured payment, attempts a Razorpay refund and emails the
// customer either way ("refund on its way" or "cancelled, nothing to refund").
//
// POST { cameraId }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { refundPayment } from '../_shared/razorpay.ts';
import { sendStatusEmail } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return jsonResponse({ error: 'not signed in' }, 401);

    const { cameraId } = await req.json();
    if (!cameraId) return jsonResponse({ error: 'missing cameraId' }, 400);

    const url = Deno.env.get('SUPABASE_URL') ?? '';

    // Forward the caller's JWT so admin_retire_camera's own role check
    // (auth.uid() -> profiles.role) is what gates this, not this function.
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data, error } = await userClient.rpc('admin_retire_camera', { p_camera_id: cameraId });
    if (error) return jsonResponse({ error: error.message }, 403);

    const refundDue = data?.refund_due ?? [];
    const noPayment = data?.cancelled_no_payment ?? [];

    // Service role from here on — issuing refunds and emailing customers
    // regardless of who's logged in when this runs.
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false },
    });

    let refundedCount = 0;
    for (const r of refundDue) {
      try {
        if (r.provider_payment_id) {
          const refund = await refundPayment(r.provider_payment_id, Math.round(r.amount * 100), {
            booking_id: r.booking_id,
            reason: 'camera_removed',
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
        // needs_refund is already flagged by admin_retire_camera — the admin
        // finishes this one from the Razorpay dashboard, same fallback
        // _shared/settle.ts already relies on for its race-condition refunds.
        console.error('auto-refund failed for booking', r.booking_id, e);
      }
      // Told either way — the needs_refund flag guarantees the refund gets
      // completed even when this automatic attempt didn't go through.
      await sendStatusEmail(svc, r.booking_id, 'camera_removed_refund', { amount: r.amount });
    }

    for (const bookingId of noPayment) {
      await sendStatusEmail(svc, bookingId, 'camera_removed', {});
    }

    return jsonResponse({
      ok: true,
      refunded: refundedCount,
      refund_pending: refundDue.length - refundedCount,
      cancelled_no_payment: noPayment.length,
    });
  } catch (err) {
    console.error('retire-camera crashed', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
