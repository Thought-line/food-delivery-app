-- Customer-initiated cancellations retain a 10% fee — only 90% of whatever
-- was captured for the booking is refunded. Admin-initiated cancellations
-- (admin_retire_camera, when a camera is retired/removed) are NOT affected
-- by this — that's the business's decision, not the customer's, so those
-- still refund in full.
--
-- Same signature as cancel_my_booking() in 20260915010000 — only the
-- refund-amount calculation changes.
--
-- Run this in the Supabase SQL editor AFTER 20260915010000.

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
    -- captured payment.
    v_refund_due := coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_id', p_booking_id,
        'provider_order_id', p.provider_order_id,
        'provider_payment_id', p.provider_payment_id,
        'amount', round(pb.allocated_amount * 0.9, 2)
      ))
      from payment_bookings pb
      join payments p on p.id = pb.payment_id
      where pb.booking_id = p_booking_id
        and p.status = 'captured'
    ), '[]'::jsonb);

    insert into notification_events (booking_id, event_type) values (p_booking_id, 'refund_pending');
  elsif v_booking.payment_status = 'pending' then
    -- Unpaid hold, nothing was ever captured — just release it. No fee since
    -- no money changed hands.
    update bookings set payment_status = 'expired' where id = p_booking_id;
  end if;

  return jsonb_build_object('refund_due', v_refund_due);
end;
$$;

-- Verify:
--   select status, payment_status from bookings where id = '<a booking id>';
