import { supabase } from './supabaseClient';

// Razorpay checkout helpers, shared by BookingForm, CartPage and MyBookingsPage.
// The server (create-booking-order / create-balance-order Edge Functions) is the
// authority on amounts — these wrappers just move the order to the browser and
// hand the signed result back to verify-payment.

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptPromise = null;

export function loadRazorpayScript() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const done = () => (window.Razorpay ? resolve(true) : reject(new Error('Payment library unavailable')));
    const fail = () => {
      scriptPromise = null;
      reject(new Error('Could not load the payment library. Check your connection and try again.'));
    };
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', fail);
      if (window.Razorpay) resolve(true);
      return;
    }
    const s = document.createElement('script');
    s.src = RAZORPAY_SCRIPT;
    s.async = true;
    s.onload = done;
    s.onerror = fail;
    document.body.appendChild(s);
  });
  return scriptPromise;
}

// 25% advance, rounded up to the paisa — matches the server's ceil(totalPaise / 4).
export function advanceEstimate(total) {
  return Math.ceil(Math.round(Number(total || 0) * 100) / 4) / 100;
}

async function invoke(fnName, body) {
  const { data, error } = await supabase.functions.invoke(fnName, { body });
  if (!error) return data;

  // supabase-js wraps a non-2xx as FunctionsHttpError. Depending on version the
  // parsed body is on `data` or must be read from the Response on `error.context`.
  let payload = data && typeof data === 'object' ? data : null;
  if (!payload) {
    try {
      payload = await error.context?.json?.();
    } catch {
      /* body already consumed or not JSON */
    }
  }
  const wrapped = new Error(payload?.error || error.message || 'Payment request failed');
  wrapped.code = payload?.error;
  wrapped.failures = payload?.failures;
  wrapped.status = error.context?.status;
  throw wrapped;
}

export function createBookingOrder({ item, items, paymentOption, name, location, phone }) {
  return invoke('create-booking-order', {
    item,
    items,
    payment_option: paymentOption === 'advance' ? 'advance' : 'full',
    name,
    location,
    phone,
  });
}

export function createBalanceOrder(bookingId) {
  return invoke('create-balance-order', { booking_id: bookingId });
}

// Customer self-cancels a not-yet-picked-up booking. Refunds (if any payment
// was captured) and the cancellation email are handled server-side.
export function cancelMyBooking(bookingId) {
  return invoke('cancel-booking', { bookingId });
}

export function verifyPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  return invoke('verify-payment', { razorpay_order_id, razorpay_payment_id, razorpay_signature });
}

// Opens Razorpay checkout for an order returned by createBookingOrder /
// createBalanceOrder. Resolves once the modal is done (paid or dismissed).
//   onSuccess(response)      — payment captured AND verify-payment succeeded
//   onDismiss()              — customer closed the modal without paying
//   onError(err, { paid })   — paid:true  = money was taken but verify failed
//                              (the webhook will still settle it — do NOT
//                               release the hold)
//                              paid:false = the payment itself failed
export async function openRazorpayCheckout({
  order,
  prefill,
  description,
  onSuccess,
  onDismiss,
  onError,
}) {
  await loadRazorpayScript();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const rzp = new window.Razorpay({
      key: order.razorpay_key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: 'DreamCapture',
      description: description || 'Camera rental',
      prefill: prefill || {},
      theme: { color: '#111827' },
      handler: async (response) => {
        try {
          await verifyPayment({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          await onSuccess?.(response);
        } catch (err) {
          // Money was captured by Razorpay; only the verify call failed. The
          // webhook is the backstop — the caller must not release the hold.
          await onError?.(err, { paid: true });
        } finally {
          finish();
        }
      },
      modal: {
        ondismiss: () => {
          onDismiss?.();
          finish();
        },
      },
    });

    rzp.on('payment.failed', (resp) => {
      onError?.(new Error(resp?.error?.description || 'Payment failed. Please try again.'), {
        paid: false,
      });
    });

    rzp.open();
  });
}
