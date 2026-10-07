-- Automatic bookings + Razorpay payments.
--
-- Removes the manual admin-approval step. A booking is now created as a
-- 15-minute HOLD (status = 'confirmed', payment_status = 'pending') by
-- create_booking_hold(); the existing check_camera_stock_availability()
-- BEFORE INSERT trigger runs on that insert and RAISEs
-- 'no_overlapping_confirmed_bookings' if the dates are already taken, so a
-- double booking is rejected atomically at request time (the trigger already
-- takes a FOR UPDATE lock on the cameras row — see 20260812020000).
--
-- Payment (Razorpay, INR) then turns the hold into a real confirmed booking:
--   * settle_payment() applies a captured payment to the linked booking(s).
--   * A booking the customer never pays for is released by expire_booking_holds()
--     (pg_cron, every minute, 3-minute reconcile margin).
--   * run_booking_lifecycle() (pg_cron, every 15 min) auto-activates a paid
--     booking on its pickup date and auto-completes it a day after the return
--     date. Dates are evaluated in IST (Asia/Kolkata).
--   * If a payment lands for a booking whose hold was already released, v1
--     does NOT resurrect it — it flags payment_status = 'refund_pending' and
--     the Edge Function issues a Razorpay refund.
--
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).
-- Idempotent / safe to replay: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT
-- EXISTS, guarded ADD CONSTRAINT, DROP POLICY IF EXISTS before CREATE POLICY,
-- CREATE OR REPLACE FUNCTION, and an unschedule-first cron block.
--
-- The check_camera_stock_availability() trigger and request_booking() are NOT
-- changed here — request_booking() and the remote-only confirm_booking /
-- reject_booking / cancel_booking stay in place so any existing 'requested'
-- rows are still drainable from the admin panel.

-- ============================================================================
-- 1. bookings: payment columns
-- ============================================================================

alter table bookings add column if not exists payment_status  text not null default 'unpaid';
alter table bookings add column if not exists amount_total     numeric(10, 2) not null default 0;
alter table bookings add column if not exists amount_paid      numeric(10, 2) not null default 0;
alter table bookings add column if not exists hold_expires_at  timestamptz;

-- payment_status values (no enum type, matching the rest of this schema):
--   unpaid         legacy row / never had a hold
--   pending        hold created, awaiting payment
--   advance_paid   25% advance captured, balance still due
--   paid           full amount captured
--   expired        hold released before payment (timeout or customer dismiss)
--   refund_pending payment captured but the hold was already gone — refund owed
--   refunded       refund completed
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_payment_status_valid') then
    alter table bookings add constraint bookings_payment_status_valid
      check (payment_status in (
        'unpaid', 'pending', 'advance_paid', 'paid', 'expired', 'refund_pending', 'refunded'
      ));
  end if;
end $$;

-- ============================================================================
-- 2. payments / payment_bookings / processed_webhook_events
-- ============================================================================

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay',
  provider_order_id text not null,
  provider_payment_id text,
  provider_refund_id text,
  payment_type text not null check (payment_type in ('advance', 'full', 'balance')),
  amount numeric(10, 2) not null,               -- rupees, for display / reconciliation
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created', 'captured', 'failed', 'refunded')),
  needs_refund boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now()
);

-- One Razorpay order per row; the unique index makes settle_payment() safe to
-- call more than once for the same order (webhook + browser fast-path race).
create unique index if not exists payments_provider_order_id_key on payments (provider_order_id);

-- A single payment can cover several bookings (cart checkout). allocated_amount
-- is each booking's exact share, decided by create-booking-order when it builds
-- the Razorpay order, so settlement never does proportional math and a partial
-- refund refunds exactly one booking's share.
create table if not exists payment_bookings (
  payment_id uuid not null references payments (id) on delete cascade,
  booking_id uuid not null references bookings (id) on delete cascade,
  allocated_amount numeric(10, 2) not null default 0,
  primary key (payment_id, booking_id)
);
create index if not exists payment_bookings_booking_id_idx on payment_bookings (booking_id);

-- Razorpay redelivers webhooks; dedupe on its x-razorpay-event-id.
create table if not exists processed_webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table payments enable row level security;
alter table payment_bookings enable row level security;
alter table processed_webhook_events enable row level security;

-- A customer reads their own payments (receipts / "balance due"); an admin
-- reads all. Same shape as bookings_select_own / bookings_select_admin.
drop policy if exists payments_select_own on payments;
create policy payments_select_own on payments
  for select to authenticated
  using (exists (
    select 1
    from payment_bookings pb
    join bookings b on b.id = pb.booking_id
    where pb.payment_id = payments.id
      and b.customer_id = auth.uid()
  ));

drop policy if exists payments_select_admin on payments;
create policy payments_select_admin on payments
  for select to authenticated
  using ((select role from profiles where id = auth.uid()) = 'admin');

drop policy if exists payment_bookings_select_own on payment_bookings;
create policy payment_bookings_select_own on payment_bookings
  for select to authenticated
  using (exists (
    select 1 from bookings b
    where b.id = payment_bookings.booking_id
      and b.customer_id = auth.uid()
  ));

drop policy if exists payment_bookings_select_admin on payment_bookings;
create policy payment_bookings_select_admin on payment_bookings
  for select to authenticated
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- No direct client writes anywhere — only the SECURITY DEFINER RPCs and the
-- service-role Edge Functions touch these tables.
revoke insert, update, delete on payments from anon, authenticated;
revoke insert, update, delete on payment_bookings from anon, authenticated;
revoke all on processed_webhook_events from anon, authenticated;

-- ============================================================================
-- 4. RPCs
-- ============================================================================

-- 4a. create_booking_hold() — the new booking entry point.
-- Called only from the create-booking-order Edge Function, via a client built
-- from the caller's JWT, so auth.uid() is the real customer (identical to
-- request_booking). Inserts status = 'confirmed' so the stock trigger fires
-- and rejects overlaps atomically.
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

  -- The BEFORE INSERT trigger check_camera_stock_availability() runs here and
  -- RAISEs 'no_overlapping_confirmed_bookings: ...' if the dates are full.
  insert into bookings (
    camera_id, start_date, end_date,
    customer_name, customer_location, customer_phone,
    customer_id, status, quantity,
    payment_status, amount_total, amount_paid, hold_expires_at
  ) values (
    p_camera_id, p_start, p_end,
    p_name, p_location, p_phone,
    auth.uid(), 'confirmed', p_quantity,
    'pending', coalesce(p_amount_total, 0), 0, now() + interval '15 minutes'
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function create_booking_hold(uuid, date, date, text, text, text, integer, numeric) from public;
grant execute on function create_booking_hold(uuid, date, date, text, text, text, integer, numeric) to authenticated;

-- 4b. cancel_unpaid_hold() — customer dismissed the Razorpay modal.
-- Idempotent: no error if the row is already settled or already released.
create or replace function cancel_unpaid_hold(p_booking_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  update bookings
  set status = 'cancelled', payment_status = 'expired', hold_expires_at = null
  where id = p_booking_id
    and customer_id = auth.uid()
    and status = 'confirmed'
    and payment_status = 'pending';
end;
$$;

revoke all on function cancel_unpaid_hold(uuid) from public;
grant execute on function cancel_unpaid_hold(uuid) to authenticated;

-- 4c. settle_payment() — apply a captured Razorpay payment to its booking(s).
-- Shared by razorpay-webhook and verify-payment; both may call it for the same
-- order, so it is idempotent (payments row locked FOR UPDATE, early return once
-- status = 'captured'). Returns { applied: uuid[], refund_due: [{booking_id, amount}] };
-- amounts are rupees (the Edge Function converts to paise for the refund API).
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
          hold_expires_at = null
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

-- 4d. mark_payment_refunded() — called from the webhook on refund.processed.
create or replace function mark_payment_refunded(p_provider_order_id text, p_provider_refund_id text)
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_payment_id uuid;
begin
  select id into v_payment_id from payments where provider_order_id = p_provider_order_id;
  if not found then
    return;
  end if;

  update payments
  set status = 'refunded',
      needs_refund = false,
      provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id)
  where id = v_payment_id;

  update bookings b
  set payment_status = 'refunded'
  from payment_bookings pb
  where pb.payment_id = v_payment_id
    and pb.booking_id = b.id
    and b.payment_status = 'refund_pending';
end;
$$;

revoke all on function mark_payment_refunded(text, text) from public;
grant execute on function mark_payment_refunded(text, text) to service_role;

-- 4e. expire_booking_holds() — pg_cron reaper, every minute.
-- 3-minute reconcile margin so a payment that commits while this run waits on
-- the row lock drops itself out of the UPDATE set.
create or replace function expire_booking_holds()
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  if not pg_try_advisory_xact_lock(4271001) then
    return;
  end if;

  with reaped as (
    update bookings
    set status = 'cancelled', payment_status = 'expired', hold_expires_at = null
    where status = 'confirmed'
      and payment_status = 'pending'
      and hold_expires_at is not null
      and hold_expires_at < now() - interval '3 minutes'
    returning id
  )
  insert into notification_events (booking_id, event_type)
  select id, 'hold_expired' from reaped;
end;
$$;

revoke all on function expire_booking_holds() from public;

-- 4f. run_booking_lifecycle() — pg_cron, every 15 minutes.
-- IST dates so "auto-activate on the pickup date" happens at IST midnight, not
-- 05:30 IST. Grace before auto-complete = 1 day (the "- 1" below), leaving the
-- return day + the next day showing the overdue badge before the booking closes.
create or replace function run_booking_lifecycle()
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not pg_try_advisory_xact_lock(4271002) then
    return;
  end if;

  with activated as (
    update bookings
    set status = 'active'
    where status = 'confirmed'
      and payment_status in ('advance_paid', 'paid')
      and start_date <= v_today
    returning id
  )
  insert into notification_events (booking_id, event_type)
  select id, 'auto_activated' from activated;

  with completed as (
    update bookings
    set status = 'completed'
    where status = 'active'
      and end_date < v_today - 1
    returning id
  )
  insert into notification_events (booking_id, event_type)
  select id, 'auto_completed' from completed;
end;
$$;

revoke all on function run_booking_lifecycle() from public;

-- ============================================================================
-- 5. One-time backfill so the new cron does not strand existing rows.
-- Auto-activate/complete only touch advance_paid/paid rows; legacy rows default
-- to 'unpaid'. Filtering on payment_status = 'unpaid' makes this replay-safe.
-- The stock trigger is disabled for just this statement — these rows were
-- already accepted, so re-validating their overlap here is pointless and would
-- abort the whole migration on any pre-existing over-committed row.
-- ============================================================================

-- Wrapped so the trigger is ALWAYS re-enabled, even if the UPDATE errors.
do $$
begin
  alter table bookings disable trigger trg_check_camera_stock_availability;

  update bookings b
  set payment_status = 'paid',
      amount_total = case
        when b.amount_total > 0 then b.amount_total
        else coalesce((select c.price from cameras c where c.id = b.camera_id), 0)
             * b.quantity * greatest(1, (b.end_date - b.start_date))
      end,
      amount_paid = case
        when b.amount_total > 0 then b.amount_total
        else coalesce((select c.price from cameras c where c.id = b.camera_id), 0)
             * b.quantity * greatest(1, (b.end_date - b.start_date))
      end
  where b.status in ('confirmed', 'active', 'completed')
    and b.payment_status = 'unpaid';

  alter table bookings enable trigger trg_check_camera_stock_availability;
exception when others then
  alter table bookings enable trigger trg_check_camera_stock_availability;
  raise;
end $$;

-- ============================================================================
-- 6. Schedule the cron jobs (last — if this fails on permissions everything
-- above is already applied). Enable pg_cron from Dashboard > Database >
-- Extensions if the CREATE EXTENSION below is rejected.
-- ============================================================================

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'booking-hold-reaper') then
    perform cron.unschedule('booking-hold-reaper');
  end if;
  if exists (select 1 from cron.job where jobname = 'booking-lifecycle') then
    perform cron.unschedule('booking-lifecycle');
  end if;
  perform cron.schedule('booking-hold-reaper', '* * * * *', 'select public.expire_booking_holds();');
  perform cron.schedule('booking-lifecycle', '*/15 * * * *', 'select public.run_booking_lifecycle();');
end $$;

-- Verify:
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select status, count(*) from bookings group by 1;      -- expect no lingering 'requested' from the new flow
--   select payment_status, count(*) from bookings group by 1;
