
alter table bookings add column if not exists identity_document_urls text[];
update bookings
set identity_document_urls = array[identity_document_url]
where identity_document_url is not null and identity_document_urls is null;

alter table bookings drop column if exists identity_document_url;

-- admin_set_booking_document() — now takes an array of paths. A submit
-- replaces whatever was on the booking before; it doesn't append across
-- separate submissions.
drop function if exists admin_set_booking_document(uuid, text, text);

create or replace function admin_set_booking_document(
  p_booking_id uuid,
  p_document_type text,
  p_document_paths text[]
)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'only admins can set a booking''s identity document';
  end if;

  if p_document_type not in ('aadhaar', 'driving_licence', 'pan', 'passport', 'other') then
    raise exception 'invalid document type';
  end if;

  if p_document_paths is null or array_length(p_document_paths, 1) is null then
    raise exception 'at least one document file is required';
  end if;

  update bookings
  set identity_document_type = p_document_type,
      identity_document_urls = p_document_paths
  where id = p_booking_id;

  if not found then
    raise exception 'booking not found';
  end if;
end;
$$;

revoke all on function admin_set_booking_document(uuid, text, text[]) from public;
grant execute on function admin_set_booking_document(uuid, text, text[]) to authenticated;

-- create_booking_hold() — unchanged signature, redefined body only to
-- snapshot the caller's current identity document (still a single value on
-- profiles) as a one-element array into the booking's own urls column.
create or replace function create_booking_hold(
  p_camera_id uuid,
  p_start date,
  p_end date,
  p_name text,
  p_location text,
  p_phone text,
  p_quantity integer,
  p_amount_total numeric
)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_camera_status text;
  v_pending_count integer;
  v_booking_id uuid;
  v_identity_document_url text;
  v_identity_document_urls text[];
  v_identity_document_type text;
begin
  if auth.uid() is null then
    raise exception 'you must be signed in to book';
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

  -- Retrying a dismissed checkout must not lock the customer out of their own
  -- dates: release this caller's own still-pending hold for the same slot.
  update bookings
  set status = 'cancelled', payment_status = 'expired', hold_expires_at = null
  where customer_id = auth.uid()
    and camera_id = p_camera_id
    and status = 'confirmed'
    and payment_status = 'pending'
    and start_date = p_start
    and end_date = p_end;

  -- Anti-abuse: cap how many holds one customer can sit on at once.
  select count(*) into v_pending_count
  from bookings
  where customer_id = auth.uid()
    and status = 'confirmed'
    and payment_status = 'pending';
  if v_pending_count >= 5 then
    raise exception 'too many pending checkouts — finish or cancel one first';
  end if;

  select identity_document_url, identity_document_type
    into v_identity_document_url, v_identity_document_type
    from profiles
    where id = auth.uid();

  v_identity_document_urls := case
    when v_identity_document_url is not null then array[v_identity_document_url]
    else null
  end;

  -- The BEFORE INSERT trigger check_camera_stock_availability() runs here and
  -- RAISEs 'no_overlapping_confirmed_bookings: ...' if the dates are full.
  insert into bookings (
    camera_id, start_date, end_date,
    customer_name, customer_location, customer_phone,
    customer_id, status, quantity,
    payment_status, amount_total, amount_paid, hold_expires_at,
    identity_document_urls, identity_document_type
  ) values (
    p_camera_id, p_start, p_end,
    p_name, p_location, p_phone,
    auth.uid(), 'confirmed', p_quantity,
    'pending', coalesce(p_amount_total, 0), 0, now() + interval '15 minutes',
    v_identity_document_urls, v_identity_document_type
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function create_booking_hold(uuid, date, date, text, text, text, integer, numeric) from public;
grant execute on function create_booking_hold(uuid, date, date, text, text, text, integer, numeric) to authenticated;
