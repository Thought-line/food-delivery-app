// Shared "invoke send-booking-status-email, log on failure, never throw"
// helper — used by any Edge Function that needs to email a customer about a
// booking status change. Extracted from _shared/settle.ts so retire-camera
// doesn't have to duplicate it.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function sendStatusEmail(
  svc: SupabaseClient,
  bookingId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await svc.functions.invoke('send-booking-status-email', {
      body: { bookingId, status, ...extra },
    });
    // functions.invoke() resolves (doesn't throw) even on a non-2xx response —
    // log it so a silent email failure is actually visible somewhere.
    if (error) console.error('send-booking-status-email invoke failed', bookingId, status, error);
  } catch (err) {
    // Best-effort — never block the caller on email delivery — but still log it.
    console.error('send-booking-status-email invoke threw', bookingId, status, err);
  }
}
