import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

// Mailtrap's Email TESTING sandbox (SMTP) — emails never leave Mailtrap,
// they land in your sandbox inbox for preview. Swap these four env vars
// (and go through Mailtrap's Sending product instead of Testing) when you're
// ready to actually deliver to real customers — nothing else here changes.
const SMTP_HOST = Deno.env.get('MAILTRAP_SMTP_HOST') ?? 'sandbox.smtp.mailtrap.io';
const SMTP_PORT = Number(Deno.env.get('MAILTRAP_SMTP_PORT') ?? '2525');
const SMTP_USERNAME = Deno.env.get('MAILTRAP_SMTP_USERNAME') ?? '';
const SMTP_PASSWORD = Deno.env.get('MAILTRAP_SMTP_PASSWORD') ?? '';
const FROM_EMAIL = Deno.env.get('BOOKING_EMAIL_FROM') ?? 'bookings@dreamcapture.example';
const FROM_NAME = Deno.env.get('BOOKING_EMAIL_FROM_NAME') ?? 'DreamCapture';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const signOff = `Thank you for choosing ${FROM_NAME}.

Warm regards,
The ${FROM_NAME} Team`;

// bookings.start_date/end_date come back from Postgres as plain
// 'YYYY-MM-DD' strings — reformat to DD.MM.YYYY to match the date format
// already shown everywhere else in the app (see src/lib/dateUtils.js's
// formatDate, which uses the same day.month.year shape).
function toDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Mirrors src/lib/common.js formatPrice.
function formatPrice(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// Blank when there's no code yet (e.g. a legacy booking paid before pickup
// codes existed) so the templates can just always splice this in.
function pickupCodeLine(pickupCode) {
  if (!pickupCode) return '';
  return `
Pickup code: ${pickupCode} — our staff will ask you for this when you collect the camera, so keep it handy (don't share it with anyone else).
`;
}

const STATUS_CONTENT = {
  confirmed: {
    subject: (cameraName) => `Your ${cameraName} booking is confirmed`,
    body: (name, cameraName, startDate, endDate) =>
      `Hello ${name},

Good news! Your booking for the ${cameraName} from ${startDate} to ${endDate} has been confirmed. We look forward to getting it into your hands.

${signOff}`,
  },
  rejected: {
    subject: (cameraName) => `Your ${cameraName} booking request was declined`,
    body: (name, cameraName, startDate, endDate) =>
      `Hello ${name},

Unfortunately your request for the ${cameraName} from ${startDate} to ${endDate} could not be accepted. Please try different dates or another camera — we'd still love to help you capture your best.

${signOff}`,
  },
  cancelled: {
    subject: (cameraName) => `Your ${cameraName} booking has been cancelled`,
    body: (name, cameraName, startDate, endDate) =>
      `Hello ${name},

Your booking for the ${cameraName} from ${startDate} to ${endDate} has been cancelled. If this wasn't expected, just reply to this email and we'll help sort it out.

${signOff}`,
  },
  active: {
    subject: (cameraName) => `Your ${cameraName} rental is now active`,
    body: (name, cameraName, startDate, endDate) =>
      `Hello ${name},

Your rental for the ${cameraName} is now active, covering ${startDate} to ${endDate}. Enjoy your shoot, and please have the gear ready for return by ${endDate}.

${signOff}`,
  },
  completed: {
    subject: (cameraName) => `Your ${cameraName} rental is complete`,
    body: (name, cameraName, startDate, endDate) =>
      `Hello ${name},

Your rental for the ${cameraName} (${startDate} to ${endDate}) has been marked complete. Thanks for returning it — we hope you got some great shots!

${signOff}`,
  },
  advance_paid: {
    subject: (cameraName) => `Advance received — your ${cameraName} booking is confirmed`,
    body: (name, cameraName, startDate, endDate, extra) =>
      `Hello ${name},

We've received your advance payment and your booking for the ${cameraName} from ${startDate} to ${endDate} is confirmed.

Balance still due: ${formatPrice(extra?.balance)}. You can pay it any time from My Bookings, or at pickup.
${pickupCodeLine(extra?.pickupCode)}
${signOff}`,
  },
  paid: {
    subject: (cameraName) => `Payment received — your ${cameraName} booking is confirmed`,
    body: (name, cameraName, startDate, endDate, extra) =>
      `Hello ${name},

Thank you — your payment is complete and your booking for the ${cameraName} from ${startDate} to ${endDate} is fully confirmed. We look forward to getting it into your hands.
${pickupCodeLine(extra?.pickupCode)}
${signOff}`,
  },
  refunded: {
    subject: (cameraName) => `Refund issued for your ${cameraName} booking`,
    body: (name, cameraName, startDate, endDate) =>
      `Hello ${name},

Your payment for the ${cameraName} (${startDate} to ${endDate}) has been refunded in full — the dates were no longer available by the time the payment completed. It may take a few business days to appear on your statement. Please do try booking again.

${signOff}`,
  },
  camera_removed_refund: {
    subject: (cameraName) => `Your ${cameraName} booking was cancelled — refund on its way`,
    body: (name, cameraName, startDate, endDate, extra) =>
      `Hello ${name},

We're sorry to say your booking for the ${cameraName} from ${startDate} to ${endDate} has been cancelled because this camera has been removed from our catalogue.

Your payment of ${formatPrice(extra?.amount)} will be refunded to your original payment method within 4–7 working days.

${signOff}`,
  },
  camera_removed: {
    subject: (cameraName) => `Your ${cameraName} booking was cancelled`,
    body: (name, cameraName, startDate, endDate) =>
      `Hello ${name},

We're sorry to say your booking for the ${cameraName} from ${startDate} to ${endDate} has been cancelled because this camera has been removed from our catalogue. No payment had been captured for this booking, so no refund is necessary.

${signOff}`,
  },
  customer_cancelled_refund: {
    subject: (cameraName) => `Your ${cameraName} booking has been cancelled — refund on its way`,
    body: (name, cameraName, startDate, endDate, extra) =>
      `Hello ${name},

Your booking for the ${cameraName} from ${startDate} to ${endDate} has been cancelled, as requested.

A ${formatPrice(extra?.fee)} cancellation fee applies. You will receive ${formatPrice(extra?.amount)} as a refund within 4–7 working days.

${signOff}`,
  },
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { bookingId, status, balance, pickupCode, amount, fee, invoiceBase64, invoiceFilename } = await req.json();

    if (!bookingId || !STATUS_CONTENT[status]) {
      return new Response(JSON.stringify({ error: 'Invalid bookingId or status' }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    // Service role client — bypasses RLS so we can read the customer's email
    // regardless of who is logged in when this function runs.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('start_date, end_date, customer_name, cameras(name), profiles:customer_id(email, full_name)')
      .eq('id', bookingId)
      .single();

    if (error || !booking?.profiles?.email) {
      return new Response(
        JSON.stringify({ error: error?.message ?? 'Booking or customer email not found' }),
        { status: 404, headers: corsHeaders }
      );
    }

    const cameraName = booking.cameras?.name ?? 'your camera';
    const customerName =
      booking.customer_name?.trim() || booking.profiles?.full_name?.trim() || 'there';
    const content = STATUS_CONTENT[status];

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: false,
        auth: { username: SMTP_USERNAME, password: SMTP_PASSWORD },
      },
      // Supabase's Edge runtime can't do STARTTLS (Deno.startTls "Bad resource
      // ID"), and Mailtrap's Testing sandbox has no implicit-TLS port (TLS is
      // optional there). Plain SMTP is acceptable for the sandbox only — a real
      // provider must use implicit TLS (tls: true, port 465) and drop this.
      debug: { noStartTLS: true, allowUnsecure: true },
    });

    try {
      await client.send({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: booking.profiles.email,
        subject: content.subject(cameraName),
        content: content.body(customerName, cameraName, toDMY(booking.start_date), toDMY(booking.end_date), { balance, pickupCode, amount, fee }),
        // Only the 'paid' email ever carries this — the invoice PDF settle.ts
        // just generated, base64-encoded.
        ...(invoiceBase64 && {
          attachments: [
            { filename: invoiceFilename || 'invoice.pdf', content: invoiceBase64, encoding: 'base64', contentType: 'application/pdf' },
          ],
        }),
      });
    } finally {
      await client.close();
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error('send-booking-status-email crashed', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
