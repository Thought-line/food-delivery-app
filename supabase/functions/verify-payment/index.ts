// Browser fast-path, called from the Razorpay checkout `handler` right after a
// successful payment. Verifies the checkout signature and settles the payment
// immediately, so the booking is confirmed within a second or two instead of
// waiting for the webhook. The webhook remains the source of truth / backstop.
//
// POST { razorpay_order_id, razorpay_payment_id, razorpay_signature }

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { verifyCheckoutSignature } from '../_shared/razorpay.ts';
import { settleAndFollowUp } from '../_shared/settle.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!req.headers.get('Authorization')) return jsonResponse({ error: 'not signed in' }, 401);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return jsonResponse({ error: 'missing fields' }, 400);
    }

    const ok = await verifyCheckoutSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );
    if (!ok) return jsonResponse({ error: 'signature mismatch' }, 400);

    const result = await settleAndFollowUp({
      providerOrderId: razorpay_order_id,
      providerPaymentId: razorpay_payment_id,
      raw: { source: 'verify-payment', razorpay_payment_id },
    });

    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    console.error('verify-payment', err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
