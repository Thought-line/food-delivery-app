// Texts a real OTP to the customer's phone via Twilio Verify — the
// trial-compliant path for OTP-style SMS on Twilio (a plain custom-text
// message via the Messages API was tried first and rejected: trial accounts
// can only send Twilio's own pre-approved OTP template, error 572006).
//
// IMPORTANT: Twilio Verify generates and owns its own code — it is NOT the
// same value as bookings.pickup_code. The actual pickup verification (what
// the admin types into "Mark handed over") is still the database code,
// emailed to the customer — that flow is unchanged. This function only
// proves SMS delivery works; nothing in the app checks the Twilio-generated
// code against anything. Wiring that up for real would mean calling Twilio's
// VerificationCheck endpoint from the admin flow instead of comparing to
// bookings.pickup_code — a bigger change than this testing feature needs.
//
// Setup: Twilio Console > Verify > Services > create one, copy its Service
// SID (starts "VA...") into TWILIO_VERIFY_SERVICE_SID.

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get('TWILIO_VERIFY_SERVICE_SID') ?? '';

// Turns a free-text Indian phone number into E.164 (+91XXXXXXXXXX), the
// format Twilio's API requires. customer_phone is typed at booking time, so
// this just takes the last 10 digits and checks they look like a mobile number.
function toE164Indian(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(last10) ? `+91${last10}` : null;
}

// Best-effort — never throws. Callers don't need their own try/catch.
// `_pickupCode` is accepted (not used) so callers don't need to change —
// see the header comment for why it's disconnected from Twilio's own code.
export async function sendPickupCodeSms(rawPhone: string | null, _pickupCode: string): Promise<void> {
  try {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
      console.error('sendPickupCodeSms: Twilio Verify env vars not set, skipping');
      return;
    }
    const to = toE164Indian(rawPhone);
    if (!to) {
      console.error('sendPickupCodeSms: no usable Indian mobile number in', rawPhone);
      return;
    }

    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, Channel: 'sms' }),
      },
    );

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('sendPickupCodeSms: Twilio Verify rejected the send', res.status, body);
    } else {
      console.log('sendPickupCodeSms: Verify OTP sent ok', to, body?.sid, body?.status);
    }
  } catch (err) {
    console.error('sendPickupCodeSms threw', err);
  }
}
