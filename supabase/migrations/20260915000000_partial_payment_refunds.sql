-- Partial-refund bookkeeping for payments that fund more than one booking
-- (a cart checkout can put several bookings under one Razorpay order via
-- payment_bookings). Previously mark_payment_refunded() always set the whole
-- payments row to status = 'refunded' the moment ANY one booking under it
-- got refunded (e.g. one camera in the cart was retired) — even though the
-- other booking(s) were still active and fully paid. This tracks how much of
-- the payment has actually come back and only calls it 'refunded' once that
-- equals the full amount; otherwise it's 'partially_refunded'.
--
-- Run this in the Supabase SQL editor AFTER 20260914060000.

-- 1. payments.refunded_amount ------------------------------------------------
alter table payments add column if not exists refunded_amount numeric(10, 2) not null default 0;

do $$
begin
  alter table payments drop constraint if exists payments_status_check;
  alter table payments add constraint payments_status_check
    check (status in ('created', 'captured', 'failed', 'partially_refunded', 'refunded'));
end $$;

-- 2. mark_payment_refunded() — gains p_refund_amount (rupees, matching
-- payments.amount's unit). CREATE OR REPLACE can't add a parameter, so drop
-- the old 2-arg signature first. p_refund_amount defaults to NULL, which
-- keeps any caller that doesn't pass it working exactly as before (refunds
-- whatever's left of the payment in one go — the pre-existing behavior).
drop function if exists mark_payment_refunded(text, text);

create or replace function mark_payment_refunded(
  p_provider_order_id text,
  p_provider_refund_id text,
  p_refund_amount numeric default null
)
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_payment payments%rowtype;
  v_new_refunded numeric(10, 2);
  v_new_status text;
begin
  select * into v_payment from payments where provider_order_id = p_provider_order_id for update;
  if not found then
    return;
  end if;

  v_new_refunded := least(
    v_payment.amount,
    v_payment.refunded_amount + coalesce(p_refund_amount, v_payment.amount - v_payment.refunded_amount)
  );
  v_new_status := case
    when v_new_refunded >= v_payment.amount then 'refunded'
    when v_new_refunded > 0 then 'partially_refunded'
    else v_payment.status
  end;

  update payments
  set status = v_new_status,
      refunded_amount = v_new_refunded,
      needs_refund = false,
      provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id)
  where id = v_payment.id;

  -- Booking-level state is unaffected by this change — still scoped to
  -- whichever booking(s) under this payment were actually refund_pending.
  update bookings b
  set payment_status = 'refunded'
  from payment_bookings pb
  where pb.payment_id = v_payment.id
    and pb.booking_id = b.id
    and b.payment_status = 'refund_pending';
end;
$$;

revoke all on function mark_payment_refunded(text, text, numeric) from public;
grant execute on function mark_payment_refunded(text, text, numeric) to service_role;

-- Verify:
--   select provider_order_id, amount, refunded_amount, status from payments where refunded_amount > 0;
