-- Splits the admin "block these dates" flow into two explicit reasons
-- instead of one generic free-text note:
--   'maintenance' — camera is out of service; just a reason, no customer.
--   'person'      — an offline/walk-in/phone booking on someone's behalf;
--                    captures their name, phone, and what they paid, using
--                    the exact same customer_name/customer_phone/
--                    amount_total/amount_paid/payment_status columns a real
--                    customer booking uses, so BookingDetailsModal (admin's
--                    "View Details") already renders it correctly with no
--                    changes there.
--
-- Run this in the Supabase SQL editor. Idempotent / safe to replay.

alter table bookings add column if not exists hold_type text;
alter table bookings add column if not exists maintenance_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_hold_type_valid') then
    alter table bookings add constraint bookings_hold_type_valid
      check (hold_type in ('maintenance', 'person'));
  end if;
end $$;

drop function if exists admin_block_camera(uuid, date, date, integer, text);

create function admin_block_camera(
  p_camera_id uuid,
  p_start date,
  p_end date,
  p_quantity integer,
  p_hold_type text,
  p_maintenance_note text default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_amount_paid numeric default null
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
  v_customer_name text;
  v_customer_phone text;
  v_amount_paid numeric;
  v_payment_status text;
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

  if p_hold_type not in ('maintenance', 'person') then
    raise exception 'invalid hold type';
  end if;

  select status into v_camera_status from cameras where id = p_camera_id;
  if not found or v_camera_status is distinct from 'active' then
    raise exception 'this camera is not available for booking';
  end if;

  if p_hold_type = 'person' then
    if p_customer_name is null or trim(p_customer_name) = '' then
      raise exception 'customer name is required';
    end if;
    if p_customer_phone is null or trim(p_customer_phone) = '' then
      raise exception 'customer phone is required';
    end if;
    v_customer_name := trim(p_customer_name);
    v_customer_phone := trim(p_customer_phone);
    v_amount_paid := greatest(coalesce(p_amount_paid, 0), 0);
    v_payment_status := case when v_amount_paid > 0 then 'paid' else 'pending' end;
  else
    v_customer_name := 'Maintenance';
    v_customer_phone := null;
    v_amount_paid := 0;
    v_payment_status := 'unpaid';
  end if;

  -- The BEFORE INSERT trigger check_camera_stock_availability() runs here and
  -- RAISEs 'no_overlapping_confirmed_bookings: ...' if the dates are full —
  -- the exact same protection a real customer booking gets.
  insert into bookings (
    camera_id, start_date, end_date, customer_id, status, quantity,
    customer_name, customer_phone, is_admin_hold, hold_type, maintenance_note,
    amount_total, amount_paid, payment_status
  ) values (
    p_camera_id, p_start, p_end, auth.uid(), 'confirmed', p_quantity,
    v_customer_name, v_customer_phone, true, p_hold_type,
    nullif(trim(coalesce(p_maintenance_note, '')), ''),
    v_amount_paid, v_amount_paid, v_payment_status
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function admin_block_camera(uuid, date, date, integer, text, text, text, text, numeric) from public;
grant execute on function admin_block_camera(uuid, date, date, integer, text, text, text, text, numeric) to authenticated;
