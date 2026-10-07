-- Adds the fee amount itself alongside the refund amount in cancel_my_booking()'s
-- return value, so the confirmation dialog and the cancellation email can both
-- state the fee and the refund as separate rupee figures (not just "10%").
-- Same signature — only the returned jsonb shape gains a 'fee' key per entry.
--
-- Run this in the Supabase SQL editor AFTER 20260915020000.

create or replace function cancel_my_booking(p_booking_id uuid)
returns jsonb
security definer
set search_path = public
language plpgsql
as $$
declare
  v_booking bookings%rowtype;
  v_refund_due jsonb := '[]'::jsonb;
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

  update bookings
  set status = 'cancelled', hold_expires_at = null
  where id = p_booking_id;
  insert into notification_events (booking_id, event_type) values (p_booking_id, 'customer_cancelled');

  if v_booking.payment_status in ('advance_paid', 'paid') then
    update bookings set payment_status = 'refund_pending' where id = p_booking_id;

    update payments p
    set needs_refund = true
    from payment_bookings pb
    where pb.payment_id = p.id
      and pb.booking_id = p_booking_id
      and p.status = 'captured';

    -- 10% cancellation fee: refund 90% of this booking's share of each
    -- captured payment, and report the withheld 10% as 'fee' so the caller
    -- can show both figures.
    v_refund_due := coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_id', p_booking_id,
        'provider_order_id', p.provider_order_id,
        'provider_payment_id', p.provider_payment_id,
        'amount', round(pb.allocated_amount * 0.9, 2),
        'fee', round(pb.allocated_amount * 0.1, 2)
      ))
      from payment_bookings pb
      join payments p on p.id = pb.payment_id
      where pb.booking_id = p_booking_id
        and p.status = 'captured'
    ), '[]'::jsonb);

    insert into notification_events (booking_id, event_type) values (p_booking_id, 'refund_pending');
  elsif v_booking.payment_status = 'pending' then
    update bookings set payment_status = 'expired' where id = p_booking_id;
  end if;

  return jsonb_build_object('refund_due', v_refund_due);
end;
$$;

-- Verify:
--   select status, payment_status from bookings where id = '<a booking id>';
