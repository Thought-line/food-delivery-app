-- Pickup verification code — proves the person collecting the camera is the
-- one who actually booked it. A 6-digit code is generated the moment a
-- booking's payment is captured (settle_payment, first payment only — a later
-- balance payment keeps the same code) and emailed to the customer. At
-- pickup, the admin asks for it and types it into "Mark handed over"
-- (activate_booking); the code must match or the transition is refused.
--
-- Legacy bookings (no pickup_code — anything paid before this migration, or
-- an old 'requested' row confirmed by hand) skip the check entirely: a null
-- pickup_code means "nothing to verify against", not "verification failed".
--
-- Run this in the Supabase SQL editor AFTER 20260911000000.

-- 1. Columns -----------------------------------------------------------------
alter table bookings add column if not exists pickup_code text;
alter table bookings add column if not exists pickup_code_verified_at timestamptz;

-- 2. settle_payment(): generate the code on first payment -------------------
create or replace function settle_payment(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_raw jsonb
)
returns jsonb
security definer
set search_path = public
language plpgsql
as $$
declare
  v_payment payments%rowtype;
  v_pb record;
  v_booking bookings%rowtype;
  v_applied uuid[] := '{}';
  v_refund_due jsonb := '[]'::jsonb;
  v_new_paid numeric(10, 2);
  v_new_status text;
begin
  select * into v_payment
  from payments
  where provider_order_id = p_provider_order_id
  for update;

  if not found then
    raise exception 'settle_payment: no payment row for order %', p_provider_order_id;
  end if;

  if v_payment.status = 'captured' then
    return jsonb_build_object('applied', '[]'::jsonb, 'refund_due', '[]'::jsonb, 'already', true);
  end if;

  update payments
  set status = 'captured',
      provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
      raw = coalesce(p_raw, raw)
  where id = v_payment.id;

  for v_pb in
    select booking_id, allocated_amount
    from payment_bookings
    where payment_id = v_payment.id
  loop
    select * into v_booking from bookings where id = v_pb.booking_id for update;
    if not found then
      continue;
    end if;

    if v_booking.status in ('confirmed', 'active')
       and v_booking.payment_status in ('pending', 'advance_paid') then
      v_new_paid := v_booking.amount_paid + v_pb.allocated_amount;
      v_new_status := case when v_new_paid >= v_booking.amount_total then 'paid' else 'advance_paid' end;

      update bookings
      set amount_paid = v_new_paid,
          payment_status = v_new_status,
          hold_expires_at = null,
          -- Only ever set once — a later balance payment keeps the code the
          -- customer was already emailed at the advance-payment step.
          pickup_code = coalesce(pickup_code, lpad(floor(random() * 1000000)::text, 6, '0'))
      where id = v_booking.id;

      v_applied := array_append(v_applied, v_booking.id);
      insert into notification_events (booking_id, event_type) values (v_booking.id, 'payment_settled');

    elsif v_booking.status = 'cancelled' then
      -- Hold released (timeout or admin) before this payment arrived.
      -- v1 rule: never resurrect — refund.
      update bookings set payment_status = 'refund_pending' where id = v_booking.id;
      update payments set needs_refund = true where id = v_payment.id;
      v_refund_due := v_refund_due || jsonb_build_object(
        'booking_id', v_booking.id,
        'amount', v_pb.allocated_amount
      );
      insert into notification_events (booking_id, event_type) values (v_booking.id, 'refund_pending');
    end if;
  end loop;

  return jsonb_build_object('applied', to_jsonb(v_applied), 'refund_due', v_refund_due);
end;
$$;

revoke all on function settle_payment(text, text, jsonb) from public;
grant execute on function settle_payment(text, text, jsonb) to service_role;

-- 3. activate_booking(): require the code, same stock re-check as before ----
-- Signature gains p_pickup_code; DROP first since CREATE OR REPLACE can't add
-- a parameter. The default NULL keeps any old 1-arg caller working (falls
-- back to "no code supplied", which only passes for a booking with no code).
drop function if exists activate_booking(uuid);

create or replace function activate_booking(p_booking_id uuid, p_pickup_code text default null)
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_camera_id   uuid;
  v_start       date;
  v_end         date;
  v_qty         integer;
  v_pickup_code text;
  v_stock       integer;
  v_committed   integer;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'only admins can update booking status';
  end if;

  select camera_id, start_date, end_date, quantity, pickup_code
    into v_camera_id, v_start, v_end, v_qty, v_pickup_code
  from bookings
  where id = p_booking_id
    and status = 'confirmed';

  if not found then
    raise exception 'booking % is not in confirmed status', p_booking_id;
  end if;

  if v_pickup_code is not null
     and (p_pickup_code is null or trim(p_pickup_code) <> v_pickup_code) then
    raise exception 'pickup_code_mismatch: the code entered does not match this booking''s pickup code';
  end if;

  -- FOR UPDATE: same reason as check_camera_stock_availability() — block a
  -- concurrent activate/confirm for the same camera instead of racing it.
  SELECT stock_quantity INTO v_stock FROM cameras WHERE id = v_camera_id FOR UPDATE;

  SELECT COALESCE(SUM(quantity), 0) INTO v_committed
  FROM bookings
  WHERE camera_id = v_camera_id
    AND status IN ('confirmed', 'active')
    AND id IS DISTINCT FROM p_booking_id
    AND start_date <= v_end
    AND end_date >= v_start;

  IF v_committed + v_qty > COALESCE(v_stock, 1) THEN
    RAISE EXCEPTION 'no_overlapping_confirmed_bookings: only % unit(s) available for camera % between % and % (booking needs %)',
      GREATEST(COALESCE(v_stock, 1) - v_committed, 0), v_camera_id, v_start, v_end, v_qty;
  END IF;

  UPDATE bookings
  SET status = 'active',
      pickup_code_verified_at = now()
  WHERE id = p_booking_id
    AND status = 'confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking % is not in confirmed status', p_booking_id;
  END IF;
END;
$$;

-- Verify:
--   select pickup_code, pickup_code_verified_at from bookings where id = '<a booking id>';
