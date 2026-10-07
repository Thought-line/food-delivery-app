-- "New" and "Trending" badges on the camera grid — both derived from real
-- data (when a camera was actually added, how many times it's actually
-- been rented), not fabricated marketing copy.
--
-- Run this in the Supabase SQL editor. Idempotent / safe to replay.

-- `cameras` never tracked when a row was added. There's no way to know
-- existing cameras' real add date retroactively, so every camera that
-- exists as of right now gets pinned to a clearly-old placeholder date —
-- deliberately NOT "now" (an earlier version of this migration did that,
-- which made every existing camera show as "New" at once; this line also
-- fixes that if you already ran it). Only cameras added AFTER this point
-- get a real, meaningful created_at, via the default set below.
--
-- NOTE — the UPDATE below is a one-time repair, not a re-safe-to-replay
-- step like the rest of this file: run it now, but if you ever paste this
-- whole migration again later (once real cameras have picked up genuine
-- created_at dates), skip that one line — replaying it unconditionally
-- would wipe every camera's real date back to the placeholder again.
alter table cameras add column if not exists created_at timestamptz;
update cameras set created_at = '2000-01-01'::timestamptz;
alter table cameras alter column created_at set default now();
alter table cameras alter column created_at set not null;

-- Real per-camera rental counts — how many bookings for this camera were
-- actually accepted (confirmed/active/completed), not just requested and
-- never approved, or requested and then rejected/cancelled. Read-only
-- aggregate, no customer PII, so safe for anon too — same justification as
-- get_booked_quantities_by_camera in 20260816000000_get_remaining_units_rpc.sql.
create or replace function get_camera_rental_counts()
returns table(camera_id uuid, rental_count integer)
security definer
set search_path = public
language sql
as $$
  select camera_id, count(*)::integer as rental_count
  from bookings
  where status in ('confirmed', 'active', 'completed')
  group by camera_id;
$$;

revoke all on function get_camera_rental_counts() from public;
grant execute on function get_camera_rental_counts() to anon, authenticated;
