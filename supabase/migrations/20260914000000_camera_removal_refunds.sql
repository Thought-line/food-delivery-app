drop policy if exists cameras_booked_read on cameras;
create policy cameras_booked_read on cameras
  for select
  to authenticated
  using (
    exists (
      select 1 from bookings b
      where b.camera_id = cameras.id
        and b.customer_id = auth.uid()
    )
  );
create or replace function admin_retire_camera(p_camera_id uuid)
returns jsonb
security definer
set search_path = public
language plpgsql
as $$
declare
  v_booking record;
  v_refund_due jsonb := '[]'::jsonb;
  v_no_payment uuid[] := '{}';
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'only admins can remove cameras';
  end if;

  update cameras set status = 'retired' where id = p_camera_id;

  for v_booking in
    select * from bookings
    where camera_id = p_camera_id
      and status in ('requested', 'confirmed', 'active')
  loop
    update bookings set status = 'cancelled' where id = v_booking.id;
    insert into notification_events (booking_id, event_type) values (v_booking.id, 'camera_removed');

    if v_booking.payment_status in ('advance_paid', 'paid') then
      update bookings set payment_status = 'refund_pending' where id = v_booking.id;

      update payments p
      set needs_refund = true
      from payment_bookings pb
      where pb.payment_id = p.id
        and pb.booking_id = v_booking.id
        and p.status = 'captured';

      v_refund_due := v_refund_due || coalesce((
        select jsonb_agg(jsonb_build_object(
          'booking_id', v_booking.id,
          'provider_order_id', p.provider_order_id,
          'provider_payment_id', p.provider_payment_id,
          'amount', pb.allocated_amount
        ))
        from payment_bookings pb
        join payments p on p.id = pb.payment_id
        where pb.booking_id = v_booking.id
          and p.status = 'captured'
      ), '[]'::jsonb);

      insert into notification_events (booking_id, event_type) values (v_booking.id, 'refund_pending');
    else
      v_no_payment := array_append(v_no_payment, v_booking.id);
    end if;
  end loop;

  return jsonb_build_object('refund_due', v_refund_due, 'cancelled_no_payment', to_jsonb(v_no_payment));
end;
$$;

revoke all on function admin_retire_camera(uuid) from public;
grant execute on function admin_retire_camera(uuid) to authenticated;
