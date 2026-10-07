-- Switches Active/Completed from automatic (date-based) to an admin tap at the
-- counter. A camera rental is a physical handover — the pickup/return date
-- alone doesn't prove the camera actually changed hands, so a booking could
-- silently become "Active" with nobody having collected it, or "Completed"
-- with the camera still out. Confirm stays fully automatic (that's a payment
-- event, not a physical one) — see 20260910000000_auto_confirm_and_payments.sql.
--
-- Run this in the Supabase SQL editor AFTER 20260910000000.

-- 1. Stop the automatic activate/complete cron -----------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'booking-lifecycle') then
    perform cron.unschedule('booking-lifecycle');
  end if;
end $$;

-- 2. Neuter the function too, so it stays harmless even if something
-- re-schedules the job by accident later. activate_booking() /
-- complete_booking() (existing, admin-gated RPCs — 20260812040000 /
-- 20260901000000) are how Active/Completed happen now, via the Admin panel's
-- "Mark handed over" / "Mark returned" buttons.
create or replace function run_booking_lifecycle()
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  -- Intentionally does nothing — see 20260911000000_manual_pickup_return.sql.
  -- Auto-activate/auto-complete were disabled in favor of an admin tap at
  -- pickup/return, so the booking status always reflects who actually has
  -- the camera right now.
  return;
end;
$$;

revoke all on function run_booking_lifecycle() from public;

-- expire_booking_holds() / the 'booking-hold-reaper' cron job are UNCHANGED —
-- releasing an unpaid 15-minute hold isn't a physical event, so that stays
-- fully automatic.

-- Verify:
--   select jobname, active from cron.job;   -- only 'booking-hold-reaper' (+ your
--                                            -- own pre-existing jobs) should be listed
