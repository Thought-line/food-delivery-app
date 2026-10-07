// Shared "a payment was captured — now reconcile it" routine, used by both
// razorpay-webhook (source of truth) and verify-payment (browser fast path).
//
// The DB function settle_payment() owns all the row-locking and status math and
// is idempotent (safe to call twice for the same order). This module acts on
// its result: send the confirmation email for bookings that got paid, and issue
// a Razorpay refund for any whose hold was already released (v1 never
// resurrects a reaped hold — see the migration header).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { refundPayment } from './razorpay.ts';
import { sendPickupCodeSms } from './sms.ts';
import { sendStatusEmail } from './notify.ts';
import { buildInvoicePdf, bytesToBase64 } from './invoice.ts';

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
}

interface SettleResult {
  applied: string[];
  refund_due: { booking_id: string; amount: number }[];
  new_pickup_codes?: string[];
  already?: boolean;
}

export async function settleAndFollowUp(args: {
  providerOrderId: string;
  providerPaymentId: string | null;
  raw: unknown;
}): Promise<SettleResult> {
  const svc = serviceClient();

  const { data, error } = await svc.rpc('settle_payment', {
    p_provider_order_id: args.providerOrderId,
    p_provider_payment_id: args.providerPaymentId,
    p_raw: args.raw ?? null,
  });
  if (error) throw new Error(`settle_payment: ${error.message}`);

  const result = (data ?? { applied: [], refund_due: [] }) as SettleResult;
  if (result.already) return result;

  const newCodeIds = new Set(result.new_pickup_codes ?? []);

  for (const bookingId of result.applied ?? []) {
    const { data: b } = await svc
      .from('bookings')
      .select(
        'payment_status, amount_total, amount_paid, pickup_code, customer_phone, ' +
        'customer_id, customer_name, quantity, start_date, end_date, invoice_path, ' +
        'cameras(name), profiles:customer_id(email, full_name)'
      )
      .eq('id', bookingId)
      .single();
    const status = b?.payment_status === 'paid' ? 'paid' : 'advance_paid';
    const balance = Math.max(0, Number(b?.amount_total ?? 0) - Number(b?.amount_paid ?? 0));

    // Only on the payment that actually completes the booking (never on a
    // partial advance), and only once — a retried webhook must not re-issue
    // an invoice that's already on file. A failure here must never stop the
    // "payment received" email itself from going out.
    let invoiceAttachment: { invoiceBase64: string; invoiceFilename: string } | undefined;
    if (status === 'paid' && !b?.invoice_path && b?.profiles?.email) {
      try {
        const pdfBytes = await buildInvoicePdf({
          bookingId,
          cameraName: b.cameras?.name ?? 'your camera',
          customerName: b.customer_name?.trim() || b.profiles?.full_name?.trim() || 'there',
          customerEmail: b.profiles.email,
          customerPhone: b.customer_phone ?? '',
          startDate: b.start_date,
          endDate: b.end_date,
          quantity: b.quantity ?? 1,
          amountTotal: Number(b.amount_total ?? 0),
          amountPaid: Number(b.amount_paid ?? 0),
        });

        const invoicePath = `${b.customer_id}/${bookingId}.pdf`;
        const { error: uploadError } = await svc.storage
          .from('invoices')
          .upload(invoicePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
        if (uploadError) throw uploadError;

        await svc.from('bookings').update({ invoice_path: invoicePath }).eq('id', bookingId);
        invoiceAttachment = { invoiceBase64: bytesToBase64(pdfBytes), invoiceFilename: `invoice-${bookingId.slice(0, 8)}.pdf` };
      } catch (e) {
        console.error('invoice generation failed for booking', bookingId, e);
      }
    }

    await sendStatusEmail(svc, bookingId, status, { balance, pickupCode: b?.pickup_code ?? null, ...invoiceAttachment });

    // Only SMS once — on the balance payment of an advance booking the code
    // already exists and was already texted, so skip re-sending (SMS costs
    // real credits; email is free either way, so it always includes the code).
    console.log('sms check', { bookingId, isNewCode: newCodeIds.has(bookingId), hasCode: Boolean(b?.pickup_code), phone: b?.customer_phone ?? null });
    if (newCodeIds.has(bookingId) && b?.pickup_code) {
      await sendPickupCodeSms(b.customer_phone ?? null, b.pickup_code);
    }
  }

  for (const r of result.refund_due ?? []) {
    if (!args.providerPaymentId) {
      console.error('refund_due but no payment id for order', args.providerOrderId);
      continue;
    }
    try {
      const refund = await refundPayment(args.providerPaymentId, Math.round(r.amount * 100), {
        booking_id: r.booking_id,
      });
      await svc.rpc('mark_payment_refunded', {
        p_provider_order_id: args.providerOrderId,
        p_provider_refund_id: refund.id ?? null,
        p_refund_amount: r.amount,
      });
      await sendStatusEmail(svc, r.booking_id, 'refunded', {});
    } catch (e) {
      // Leave payments.needs_refund = true for the admin to action from the
      // Razorpay dashboard. Don't fail the whole webhook over it.
      console.error('auto-refund failed for booking', r.booking_id, e);
    }
  }

  return result;
}
