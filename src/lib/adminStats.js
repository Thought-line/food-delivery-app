import { supabase } from './supabaseClient';
export async function fetchPeriodStats(period, offset = 0) {
  const { data, error } = await supabase.rpc('admin_period_stats', {
    p_period: period,
    p_offset: offset,
  });
  if (error) throw error;
  return data;
}
