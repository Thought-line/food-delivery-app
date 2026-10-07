import { supabase } from './supabaseClient';

// Camera ids the given user has wishlisted, cover-photo-grid-friendly (just
// the ids — callers already have the camera objects from wherever they're
// listing cameras, e.g. CameraList's `cameras` state).
export async function fetchWishlistCameraIds(userId) {
  const { data, error } = await supabase.from('wishlists').select('camera_id').eq('user_id', userId);
  if (error) throw error;
  return data.map((row) => row.camera_id);
}

// Full camera rows for WishlistPage, newest-saved first. Uses PostgREST's
// embedded-select to join in one round trip (same pattern as MyBookingsPage's
// `cameras(name, price)` and AdminPanel's `profiles:customer_id(email)`).
// A wishlisted camera that's since been retired still comes back here (see
// the cameras_wishlisted_read policy, additive on top of cameras_public_read)
// so WishlistPage can show it as "Unavailable" instead of it just
// disappearing. The `.filter(Boolean)` below is now only a defensive
// fallback for a row that's genuinely gone (e.g. hard-deleted, not retired).
export async function fetchWishlistCameras(userId) {
  const { data, error } = await supabase
    .from('wishlists')
    .select('camera_id, created_at, cameras(id, name, model, image_url, photos, price, stock_quantity, status)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => row.cameras).filter(Boolean);
}

export async function addToWishlist(userId, cameraId) {
  // ignoreDuplicates so a double-click (or a stale retry) doesn't surface a
  // unique-violation error — the end state is the same either way.
  const { error } = await supabase
    .from('wishlists')
    .upsert({ user_id: userId, camera_id: cameraId }, { onConflict: 'user_id,camera_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeFromWishlist(userId, cameraId) {
  const { error } = await supabase
    .from('wishlists')
    .delete()
    .eq('user_id', userId)
    .eq('camera_id', cameraId);
  if (error) throw error;
}
