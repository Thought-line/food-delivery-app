-- Tracks which bookings just got a BRAND NEW pickup_code this call, so the
-- Edge Function only sends the (rate-limited, paid-per-message) SMS once —
-- on the balance payment of an advance booking, settle_payment still applies
-- normally but the code already existed, so no second SMS goes out. Email
-- keeps including the code on every payment event regardless, since that's
-- effectively free.
--
-- Run this in the Supabase SQL editor AFTER 20260911010000.
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
  v_new_codes uuid[] := '{}';
  v_refund_due jsonb := '[]'::jsonb;
  v_new_paid numeric(10, 2);
  v_new_status text;
  v_had_code boolean;
begin
  select * into v_payment
  from payments
  where provider_order_id = p_provider_order_id
  for update;

  if not found then
    raise exception 'settle_payment: no payment row for order %', p_provider_order_id;
  end if;

  if v_payment.status = 'captured' then
    return jsonb_build_object(
      'applied', '[]'::jsonb, 'refund_due', '[]'::jsonb,
      'new_pickup_codes', '[]'::jsonb, 'already', true
    );
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
      v_had_code := v_booking.pickup_code is not null;
      v_new_paid := v_booking.amount_paid + v_pb.allocated_amount;
      v_new_status := case when v_new_paid >= v_booking.amount_total then 'paid' else 'advance_paid' end;

      update bookings
      set amount_paid = v_new_paid,
          payment_status = v_new_status,
          hold_expires_at = null,
          pickup_code = coalesce(pickup_code, lpad(floor(random() * 1000000)::text, 6, '0'))
      where id = v_booking.id;

      v_applied := array_append(v_applied, v_booking.id);
      if not v_had_code then
        v_new_codes := array_append(v_new_codes, v_booking.id);
      end if;
      insert into notification_events (booking_id, event_type) values (v_booking.id, 'payment_settled');

    elsif v_booking.status = 'cancelled' then
      update bookings set payment_status = 'refund_pending' where id = v_booking.id;
      update payments set needs_refund = true where id = v_payment.id;
      v_refund_due := v_refund_due || jsonb_build_object(
        'booking_id', v_booking.id,
        'amount', v_pb.allocated_amount
      );
      insert into notification_events (booking_id, event_type) values (v_booking.id, 'refund_pending');
    end if;
  end loop;

  return jsonb_build_object(
    'applied', to_jsonb(v_applied),
    'refund_due', v_refund_due,
    'new_pickup_codes', to_jsonb(v_new_codes)
  );
end;
$$;
revoke all on function settle_payment(text, text, jsonb) from public;
grant execute on function settle_payment(text, text, jsonb) to service_role;
