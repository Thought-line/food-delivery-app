// Razorpay webhook — the source of truth for payment state.
//
// Deploy with JWT verification OFF (Razorpay can't send a Supabase JWT):
//   supabase functions deploy razorpay-webhook --no-verify-jwt
//
// Security: HMAC-SHA256 of the RAW body with RAZORPAY_WEBHOOK_SECRET must match
// the x-razorpay-signature header, checked before any DB work. Redeliveries are
// deduped on x-razorpay-event-id. Every recognized event ends 200 so Razorpay
// stops retrying; state is always recoverable from settle_payment's idempotency.
//
// Register for events: payment.captured, order.paid, payment.failed,
// refund.processed (refund.created optional).

import { jsonResponse } from '../_shared/cors.ts';
import { verifyWebhookSignature } from '../_shared/razorpay.ts';
import { serviceClient, settleAndFollowUp } from '../_shared/settle.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature');
  if (!(await verifyWebhookSignature(raw, signature))) {
    return jsonResponse({ error: 'bad signature' }, 400);
  }

  const svc = serviceClient();

  const eventId = req.headers.get('x-razorpay-event-id') ?? '';
  if (eventId) {
    const { error: dupErr } = await svc.from('processed_webhook_events').insert({ event_id: eventId });
    if (dupErr) return jsonResponse({ ok: true, deduped: true }); // unique violation = already handled
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'bad json' }, 400);
  }

  const event = String((payload as { event?: string }).event ?? '');
  // deno-lint-ignore no-explicit-any
  const p = (payload as any).payload ?? {};

  try {
    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = p.payment?.entity;
      const orderEntity = p.order?.entity;
      const orderId = paymentEntity?.order_id ?? orderEntity?.id ?? null;
      const paymentId = paymentEntity?.id ?? null;
      if (orderId) {
        await settleAndFollowUp({
          providerOrderId: orderId,
          providerPaymentId: paymentId,
          raw: payload,
        });
      }
    } else if (event === 'payment.failed') {
      const orderId = p.payment?.entity?.order_id;
      if (orderId) {
        await svc
          .from('payments')
          .update({ status: 'failed', raw: payload })
          .eq('provider_order_id', orderId)
          .neq('status', 'captured');
      }
    } else if (event === 'refund.processed' || event === 'refund.created') {
      const refund = p.refund?.entity;
      if (refund?.payment_id) {
        const { data: row } = await svc
          .from('payments')
          .select('provider_order_id')
          .eq('provider_payment_id', refund.payment_id)
          .maybeSingle();
        if (row?.provider_order_id) {
          // Razorpay reports the refund amount in paise; payments.amount (and
          // therefore mark_payment_refunded's p_refund_amount) is rupees.
          const refundAmountRupees = typeof refund.amount === 'number' ? refund.amount / 100 : null;
          await svc.rpc('mark_payment_refunded', {
            p_provider_order_id: row.provider_order_id,
            p_provider_refund_id: refund.id ?? null,
            p_refund_amount: refundAmountRupees,
          });
        }
      }
    }
  } catch (err) {
    console.error('razorpay-webhook handler error', event, err);
    // fall through to 200 — the row state is recoverable and retries won't help
  }

  return jsonResponse({ ok: true });
});
