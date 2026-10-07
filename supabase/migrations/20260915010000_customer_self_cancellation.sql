-- Customer self-service cancellation. A customer can cancel their own
-- booking any time before pickup (status = 'confirmed' — once handed over
-- it's 'active' and there's nothing left to self-cancel). Reuses the same
-- partial-refund-aware flow as admin_retire_camera(): flag the captured
-- payment(s) as needing a refund and hand back enough for the calling Edge
-- Function to issue the actual Razorpay refund and email the customer.
--
-- Run this in the Supabase SQL editor AFTER 20260915000000.

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

    v_refund_due := coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_id', p_booking_id,
        'provider_order_id', p.provider_order_id,
        'provider_payment_id', p.provider_payment_id,
        'amount', pb.allocated_amount
      ))
      from payment_bookings pb
      join payments p on p.id = pb.payment_id
      where pb.booking_id = p_booking_id
        and p.status = 'captured'
    ), '[]'::jsonb);

    insert into notification_events (booking_id, event_type) values (p_booking_id, 'refund_pending');
  elsif v_booking.payment_status = 'pending' then
    -- Unpaid hold, nothing was ever captured — just release it.
    update bookings set payment_status = 'expired' where id = p_booking_id;
  end if;

  return jsonb_build_object('refund_due', v_refund_due);
end;
$$;

revoke all on function cancel_my_booking(uuid) from public;
grant execute on function cancel_my_booking(uuid) to authenticated;

-- Verify:
--   select status, payment_status from bookings where id = '<a booking id>';
