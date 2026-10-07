-- Powers the Daily/Weekly/Monthly/All-time toggle on the admin stats cards
-- (AdminStats.jsx). One RPC does all the date-range math server-side, in IST,
-- matching every other date-sensitive RPC in this project (create_booking_hold,
-- run_booking_lifecycle, ...) rather than replicating timezone arithmetic in
-- the browser. p_offset: 0 = the current/most-recent period, -1 = one period
-- back, etc. — the frontend steps through history by decrementing it; it must
-- never be positive (no viewing future periods).
--
-- Active/Retired Cameras are always the CURRENT catalog counts regardless of
-- period — there's no history table for camera status, and it wouldn't mean
-- much anyway ("how many cameras were active last Tuesday" isn't a fleet
-- metric this business tracks) — only Total Bookings/Cancelled are actually
-- scoped to the selected date range (by bookings.created_at).
--
-- Run this in the Supabase SQL editor AFTER 20260915030000.

create or replace function admin_period_stats(p_period text, p_offset integer default 0)
returns jsonb
security definer
set search_path = public
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_start date;
  v_end date;
  v_prev_start date;
  v_prev_end date;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_prev_start_ts timestamptz;
  v_prev_end_ts timestamptz;
  v_label text;
  v_total integer;
  v_cancelled integer;
  v_prev_total integer;
  v_prev_cancelled integer;
  v_active_cameras integer;
  v_retired_cameras integer;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'only admins can view stats';
  end if;

  if p_period not in ('day', 'week', 'month', 'all') then
    raise exception 'invalid period';
  end if;

  if p_offset > 0 then
    raise exception 'offset cannot be in the future';
  end if;

  if p_period = 'day' then
    v_start := (v_today + make_interval(days => p_offset))::date;
    v_end := (v_start + interval '1 day')::date;
    v_prev_start := (v_start - interval '1 day')::date;
    v_prev_end := v_start;
    v_label := to_char(v_start, 'Dy, DD Mon YYYY');

  elsif p_period = 'week' then
    v_start := (date_trunc('week', v_today::timestamp) + make_interval(days => p_offset * 7))::date;
    v_end := (v_start + interval '7 days')::date;
    v_prev_start := (v_start - interval '7 days')::date;
    v_prev_end := v_start;
    v_label := 'Wk of ' || to_char(v_start, 'DD Mon') || '–' || to_char(v_end - 1, 'DD Mon YYYY');

  elsif p_period = 'month' then
    v_start := (date_trunc('month', v_today::timestamp) + make_interval(months => p_offset))::date;
    v_end := (v_start + interval '1 month')::date;
    v_prev_start := (v_start - interval '1 month')::date;
    v_prev_end := v_start;
    v_label := to_char(v_start, 'Mon YYYY') || case when v_end > v_today then ' (to date)' else '' end;
  end if;

  if p_period <> 'all' then
    v_start_ts := v_start::timestamp at time zone 'Asia/Kolkata';
    v_end_ts := v_end::timestamp at time zone 'Asia/Kolkata';
    v_prev_start_ts := v_prev_start::timestamp at time zone 'Asia/Kolkata';
    v_prev_end_ts := v_prev_end::timestamp at time zone 'Asia/Kolkata';

    select count(*) into v_total from bookings where created_at >= v_start_ts and created_at < v_end_ts;
    select count(*) into v_cancelled from bookings
      where created_at >= v_start_ts and created_at < v_end_ts and status = 'cancelled';
    select count(*) into v_prev_total from bookings
      where created_at >= v_prev_start_ts and created_at < v_prev_end_ts;
    select count(*) into v_prev_cancelled from bookings
      where created_at >= v_prev_start_ts and created_at < v_prev_end_ts and status = 'cancelled';
  else
    select count(*) into v_total from bookings;
    select count(*) into v_cancelled from bookings where status = 'cancelled';
    v_prev_total := null;
    v_prev_cancelled := null;
    v_label := 'All time';
  end if;

  select count(*) into v_active_cameras from cameras where status = 'active';
  select count(*) into v_retired_cameras from cameras where status = 'retired';

  return jsonb_build_object(
    'label', v_label,
    'totalBookings', v_total,
    'cancelled', v_cancelled,
    'activeCameras', v_active_cameras,
    'retiredCameras', v_retired_cameras,
    'prevTotalBookings', v_prev_total,
    'prevCancelled', v_prev_cancelled
  );
end;
$$;

revoke all on function admin_period_stats(text, integer) from public;
grant execute on function admin_period_stats(text, integer) to authenticated;

-- Verify:
--   select admin_period_stats('day', 0);
--   select admin_period_stats('week', -1);
--   select admin_period_stats('all', 0);
