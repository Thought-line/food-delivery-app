import { supabase } from './supabaseClient';

// The customer's own account details beyond what auth already carries
// (email) — full_name/phone/structured address — editable from
// ProfilePage.jsx and used to pre-fill the "who's picking this up" fields
// on every booking (see useProfileContactDefaults.js) instead of asking
// again each time.
export async function fetchMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, phone, pincode, state, address_line, locality, city, email')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// SECURITY DEFINER RPC — only ever touches the caller's own row (see
// 20260914020000_profile_structured_address.sql), never role/email.
export async function updateMyProfile({ fullName, phone, pincode, state, addressLine, locality, city }) {
  const { error } = await supabase.rpc('update_my_profile', {
    p_full_name: fullName,
    p_phone: phone,
    p_pincode: pincode,
    p_state: state,
    p_address_line: addressLine,
    p_locality: locality,
    p_city: city,
  });
  if (error) throw error;
}

// Joins the structured address into the single free-text line BookingForm/
// CartPage's ContactFields still use — those forms don't need pincode/
// state/etc. broken out, just a quick line for pickup-time verification.
// Takes the same camelCase shape ProfilePage.jsx's own draft/savedProfile
// state uses (addressLine/locality/city/state/pincode).
export function composeAddress({ addressLine, locality, city, state, pincode } = {}) {
  return [addressLine, locality, city, state, pincode].filter(Boolean).join(', ');
}
