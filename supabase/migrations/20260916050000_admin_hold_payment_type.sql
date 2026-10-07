drop function if exists admin_block_camera(uuid, date, date, integer, text, text, text, text, numeric);
create function admin_block_camera(
  p_camera_id uuid,
  p_start date,
  p_end date,
  p_quantity integer,
  p_hold_type text,
  p_maintenance_note text default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_payment_type text default null
)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_camera_status text;
  v_camera_price numeric;
  v_booking_id uuid;
  v_customer_name text;
  v_customer_phone text;
  v_days integer;
  v_amount_total numeric;
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

  select status, price into v_camera_status, v_camera_price from cameras where id = p_camera_id;
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
    if p_payment_type not in ('advance', 'full') then
      raise exception 'invalid payment type';
    end if;

    v_customer_name := trim(p_customer_name);
    v_customer_phone := trim(p_customer_phone);
    v_days := greatest(p_end - p_start, 1);
    v_amount_total := coalesce(v_camera_price, 0) * p_quantity * v_days;

    if p_payment_type = 'full' then
      v_amount_paid := v_amount_total;
      v_payment_status := 'paid';
    else
      -- 25%, rounded up to the paisa — matches pricing.ts's ceil(totalPaise / 4).
      v_amount_paid := ceil(v_amount_total * 100 / 4.0) / 100.0;
      v_payment_status := 'advance_paid';
    end if;
  else
    v_customer_name := 'Maintenance';
    v_customer_phone := null;
    v_amount_total := 0;
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
    v_amount_total, v_amount_paid, v_payment_status
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function admin_block_camera(uuid, date, date, integer, text, text, text, text, text) from public;
grant execute on function admin_block_camera(uuid, date, date, integer, text, text, text, text, text) to authenticated;
