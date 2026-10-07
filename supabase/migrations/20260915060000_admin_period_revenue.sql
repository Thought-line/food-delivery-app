-- Adds a 'revenue' figure to admin_period_stats() — sum(amount_paid) for the
-- selected period, scoped by bookings.created_at exactly like totalBookings/
-- cancelled already are (so a booking made in August but paid off in
-- September counts toward August's revenue, same convention as the other
-- two period-scoped cards). amount_paid, not amount_total, since this is
-- money actually collected, not full booking value including any balance
-- still owed. Same signature — just adds one more key to the returned jsonb.
--
-- Run this in the Supabase SQL editor AFTER 20260915050000.

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
  v_short_label text;
  v_total integer;
  v_cancelled integer;
  v_prev_total integer;
  v_prev_cancelled integer;
  v_revenue numeric;
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
    v_short_label := to_char(v_start, 'DD Mon YYYY');

  elsif p_period = 'week' then
    v_start := (date_trunc('week', v_today::timestamp) + make_interval(days => p_offset * 7))::date;
    v_end := (v_start + interval '7 days')::date;
    v_prev_start := (v_start - interval '7 days')::date;
    v_prev_end := v_start;
    v_short_label := to_char(v_start, 'DD Mon') || '–' || to_char(v_end - 1, 'DD Mon YYYY');
    v_label := 'Wk of ' || v_short_label;

  elsif p_period = 'month' then
    v_start := (date_trunc('month', v_today::timestamp) + make_interval(months => p_offset))::date;
    v_end := (v_start + interval '1 month')::date;
    v_prev_start := (v_start - interval '1 month')::date;
    v_prev_end := v_start;
    v_short_label := to_char(v_start, 'Mon YYYY');
    v_label := v_short_label || case when v_end > v_today then ' (to date)' else '' end;

  else
    v_label := 'All time';
    v_short_label := 'All time';
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
    select coalesce(sum(amount_paid), 0) into v_revenue from bookings
      where created_at >= v_start_ts and created_at < v_end_ts;
  else
    select count(*) into v_total from bookings;
    select count(*) into v_cancelled from bookings where status = 'cancelled';
    select coalesce(sum(amount_paid), 0) into v_revenue from bookings;
    v_prev_total := null;
    v_prev_cancelled := null;
  end if;

  select count(*) into v_active_cameras from cameras where status = 'active';
  select count(*) into v_retired_cameras from cameras where status = 'retired';

  return jsonb_build_object(
    'label', v_label,
    'shortLabel', v_short_label,
    'totalBookings', v_total,
    'cancelled', v_cancelled,
    'revenue', v_revenue,
    'activeCameras', v_active_cameras,
    'retiredCameras', v_retired_cameras,
    'prevTotalBookings', v_prev_total,
    'prevCancelled', v_prev_cancelled
  );
end;
$$;

-- Verify:
--   select admin_period_stats('all', 0) ->> 'revenue';
