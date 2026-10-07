import { supabase } from './supabaseClient';

// The base "all active cameras" query, shared by anywhere that just needs
// the catalogue (name/model/price/photo) without per-date availability math
// — CameraList.jsx layers booked-quantity totals on top of this for the
// grid; SearchDrawer.jsx uses it as-is for search/browse.
export async function fetchActiveCameras() {
  const { data, error } = await supabase
    .from('cameras')
    .select('id, name, model, status, image_url, stock_quantity, price, created_at')
    .eq('status', 'active')
    .order('name');
  if (error) throw error;
  return data;
}
