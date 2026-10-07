import { supabase } from './supabaseClient';

// Admin-only write: reserve a camera for dates without going through a real
// customer checkout — either 'maintenance' (camera out of service, just a
// reason) or 'person' (an offline/walk-in/phone booking, capturing their
// name/phone/and whether they paid in full or just the advance). The
// amount itself (camera price × quantity × days) is computed server-side,
// same as a real booking — this never sends a client-computed total.
// Inserts a normal bookings row (status='confirmed', is_admin_hold=true)
// that goes through the exact same stock trigger as any customer booking —
// see supabase/migrations/20260916050000_admin_hold_payment_type.sql. Kept
// separate from availability.js (read-only) since this is a write.
export async function adminBlockCamera(cameraId, startDate, endDate, quantity, holdInfo) {
  const { holdType, maintenanceNote, customerName, customerPhone, paymentType } = holdInfo;
  const { data, error } = await supabase.rpc('admin_block_camera', {
    p_camera_id: cameraId,
    p_start: startDate,
    p_end: endDate,
    p_quantity: quantity,
    p_hold_type: holdType,
    p_maintenance_note: holdType === 'maintenance' ? (maintenanceNote || null) : null,
    p_customer_name: holdType === 'person' ? (customerName || null) : null,
    p_customer_phone: holdType === 'person' ? (customerPhone || null) : null,
    p_payment_type: holdType === 'person' ? (paymentType || 'full') : null,
  });

  if (error) throw error;
  return data; // new booking id
}
