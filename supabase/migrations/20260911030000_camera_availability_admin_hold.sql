alter table bookings add column if not exists is_admin_hold boolean not null default false;
create or replace function get_camera_daily_availability(
  p_camera_id uuid,
  p_start date,
  p_end date
)
returns table(day date, stock integer, booked integer, available integer)
security definer
set search_path = public
language sql
as $$
  select
    d.day,
    c.stock_quantity,
    coalesce(sum(b.quantity), 0)::integer as booked,
    greatest(c.stock_quantity - coalesce(sum(b.quantity), 0), 0)::integer as available
  from generate_series(p_start, p_end, interval '1 day') as d(day)
  cross join cameras c
  left join bookings b
    on b.camera_id = c.id
   and b.status in ('confirmed', 'active')
   and b.start_date <= d.day
   and b.end_date >= d.day
  where c.id = p_camera_id
  group by d.day, c.stock_quantity
  order by d.day;
$$;
create or replace function admin_block_camera(
  p_camera_id uuid,
  p_start date,
  p_end date,
  p_quantity integer,
  p_note text default null
)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_camera_status text;
  v_booking_id uuid;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'only admins can block camera dates';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'quantity must be at least 1';
  end if;

  if p_end <= p_start then
    raise exception 'end date must be after the start date';
  end if;

  if p_start < v_today then
    raise exception 'start date cannot be in the past';
  end if;

  select status into v_camera_status from cameras where id = p_camera_id;
  if not found or v_camera_status is distinct from 'active' then
    raise exception 'this camera is not available for booking';
  end if;

  -- The BEFORE INSERT trigger check_camera_stock_availability() runs here and
  -- RAISEs 'no_overlapping_confirmed_bookings: ...' if the dates are full —
  -- the exact same protection a real customer booking gets.
  insert into bookings (
    camera_id, start_date, end_date, customer_id, status, quantity,
    customer_name, is_admin_hold
  ) values (
    p_camera_id, p_start, p_end, auth.uid(), 'confirmed', p_quantity,
    coalesce(nullif(trim(p_note), ''), 'Admin hold'), true
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function admin_block_camera(uuid, date, date, integer, text) from public;
grant execute on function admin_block_camera(uuid, date, date, integer, text) to authenticated;

-- Verify:
--   select * from get_camera_daily_availability('<camera-id>', current_date, current_date + 30);
--   select admin_block_camera('<camera-id>', current_date + 5, current_date + 8, 1, 'Maintenance test');
--   select status, payment_status, is_admin_hold, customer_id, customer_name
--     from bookings order by created_at desc limit 1;
