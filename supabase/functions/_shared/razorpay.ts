// Razorpay REST + signature helpers. Secrets live only here (Edge Function
// env): RAZORPAY_KEY_ID (also returned to the browser — publishable),
// RAZORPAY_KEY_SECRET (order creation + checkout-callback signature),
// RAZORPAY_WEBHOOK_SECRET (webhook body signature).

const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';
const API = 'https://api.razorpay.com/v1';

export function razorpayKeyId(): string {
  return KEY_ID;
}

function basicAuth(): string {
  return 'Basic ' + btoa(`${KEY_ID}:${KEY_SECRET}`);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export async function createOrder(opts: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const amount = Math.max(100, Math.round(opts.amountPaise)); // Razorpay min = ₹1
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      currency: 'INR',
      receipt: opts.receipt.slice(0, 40),
      notes: opts.notes ?? {},
    }),
  });
  if (!res.ok) {
    throw new Error(`razorpay order create failed: ${res.status} ${await res.text()}`);
  }
  const order = await res.json();
  return { id: order.id, amount: order.amount, currency: order.currency };
}

export async function refundPayment(
  paymentId: string,
  amountPaise: number,
  notes?: Record<string, string>,
): Promise<{ id?: string }> {
  const res = await fetch(`${API}/payments/${paymentId}/refund`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.max(100, Math.round(amountPaise)), notes: notes ?? {} }),
  });
  if (!res.ok) {
    throw new Error(`razorpay refund failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

// Checkout success callback: HMAC of `${order_id}|${payment_id}` with KEY_SECRET.
export async function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  if (!KEY_SECRET || !signature) return false;
  const expected = await hmacHex(KEY_SECRET, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, signature);
}

// Webhook: HMAC of the RAW request body with WEBHOOK_SECRET.
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = await hmacHex(WEBHOOK_SECRET, rawBody);
  return timingSafeEqual(expected, signature);
}
