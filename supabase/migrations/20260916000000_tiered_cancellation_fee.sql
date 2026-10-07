-- Replaces the flat 10% customer-cancellation fee with a tiered, time-based
-- policy, matching src/lib/cancellationTerms.js's getCancellationTerms()
-- (that JS function is only a client-side preview shown in the confirm
-- dialog — this function is the actual authority, computed fresh with the
-- database's own clock and the booking's stored created_at/amount, exactly
-- as it should be: a client never gets to hand the server a fee number).
--
-- Policy:
--   - Grace period: cancelling within 2 hours of when the booking was made
--     is always 0% fee, regardless of how close the rental start date is.
--   - Otherwise, by whole days remaining until the rental start date:
--       7+ days   -> 0%    3-6 days -> 10%   1-2 days -> 25%
--       0 or fewer (started, or same day) -> 100% (non-refundable)
--
-- Same signature as the existing cancel_my_booking() — only the fee
-- calculation and the returned jsonb (now also reporting the computed
-- terms) change.
--
-- Run this in the Supabase SQL editor AFTER 20260915030000.

create or replace function cancel_my_booking(p_booking_id uuid)
returns jsonb
security definer
set search_path = public
language plpgsql
as $$
declare
  v_booking bookings%rowtype;
  v_refund_due jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_is_grace boolean;
  v_days_until_start integer;
  v_fee_percent numeric;
begin
  if auth.uid() is null then
    raise exception 'you must be signed in to cancel a booking';
  end if;

  select * into v_booking
  from bookings
  where id = p_booking_id
    and customer_id = auth.uid()
  for update;

  if not found then
    raise exception 'booking not found';
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception 'only a booking that has not yet been picked up can be cancelled';
  end if;

  -- Grace period always wins, even if the tier table would also give 0% or
  -- a booking is cancelled the same hour it's made for a same-day rental.
  v_is_grace := (v_now - v_booking.created_at) <= interval '2 hours';

  -- Whole days remaining until the rental start date, in IST (matching
  -- every other date computation in this schema) — 0 once the start date
  -- has arrived, negative once it's passed.
  v_days_until_start := v_booking.start_date - (v_now at time zone 'Asia/Kolkata')::date;

  if v_is_grace then
    v_fee_percent := 0;
  elsif v_days_until_start >= 7 then
    v_fee_percent := 0;
  elsif v_days_until_start >= 3 then
    v_fee_percent := 10;
  elsif v_days_until_start >= 1 then
    v_fee_percent := 25;
  else
    v_fee_percent := 100;
  end if;

  update bookings
  set status = 'cancelled', hold_expires_at = null
  where id = p_booking_id;
  insert into notification_events (booking_id, event_type) values (p_booking_id, 'customer_cancelled');

  if v_booking.payment_status in ('advance_paid', 'paid') then
    if v_fee_percent >= 100 then
      -- Fully non-refundable — nothing is owed back, so this closes out
      -- immediately rather than sitting in refund_pending forever with no
      -- refund entry to ever resolve it.
      update bookings set payment_status = 'refunded' where id = p_booking_id;
    else
      update bookings set payment_status = 'refund_pending' where id = p_booking_id;

      update payments p
      set needs_refund = true
      from payment_bookings pb
      where pb.payment_id = p.id
        and pb.booking_id = p_booking_id
        and p.status = 'captured';

      v_refund_due := coalesce((
        select jsonb_agg(jsonb_build_object(
          'booking_id', p_booking_id,
          'provider_order_id', p.provider_order_id,
          'provider_payment_id', p.provider_payment_id,
          'amount', round(pb.allocated_amount * (1 - v_fee_percent / 100.0), 2),
          'fee', round(pb.allocated_amount * (v_fee_percent / 100.0), 2)
        ))
        from payment_bookings pb
        join payments p on p.id = pb.payment_id
        where pb.booking_id = p_booking_id
          and p.status = 'captured'
      ), '[]'::jsonb);

      insert into notification_events (booking_id, event_type) values (p_booking_id, 'refund_pending');
    end if;
  elsif v_booking.payment_status = 'pending' then
    -- Unpaid hold, nothing was ever captured — just release it. No fee
    -- since no money changed hands.
    update bookings set payment_status = 'expired' where id = p_booking_id;
  end if;

  return jsonb_build_object(
    'refund_due', v_refund_due,
    'isGracePeriod', v_is_grace,
    'daysUntilStart', v_days_until_start,
    'feePercent', v_fee_percent
  );
end;
$$;

-- Verify:
--   select status, payment_status from bookings where id = '<a booking id>';
--   select cancel_my_booking('<a booking id belonging to the calling user>');
