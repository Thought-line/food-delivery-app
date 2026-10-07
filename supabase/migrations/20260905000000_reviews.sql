-- Customer reviews for completed rentals.
-- Run this in the Supabase SQL editor. Idempotent / safe to replay
-- (CREATE OR REPLACE, DROP POLICY IF EXISTS before CREATE POLICY,
-- ADD COLUMN IF NOT EXISTS), matching the style of prior migrations here.

-- One review per completed booking.
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  camera_id uuid not null references cameras (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  -- Snapshot of the reviewer's account name (profiles.full_name, or their
  -- email if no name is set — the exact fallback Navbar.jsx already uses
  -- for a signed-in customer's display name), taken at submit_review()
  -- time. Not a live join to `profiles` — an anon visitor can read reviews
  -- (see policy below) but has no RLS access to `profiles`, so an embedded
  -- join would just come back null for them.
  customer_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table reviews enable row level security;

-- Reviews are shown on the public camera details page — anyone can read.
drop policy if exists reviews_public_read on reviews;
create policy reviews_public_read on reviews for select to anon, authenticated using (true);

-- No direct client writes — only through submit_review() below, matching
-- how `bookings` itself has direct INSERT/UPDATE/DELETE revoked.
revoke insert, update, delete on reviews from anon, authenticated;

-- "Have we nudged this customer about reviewing this booking" bookkeeping —
-- same idea as pickup_reminder_sent/return_reminder_sent, generalized to a
-- counter (0 = never dismissed, so show immediately) + a timestamp (gates
-- the cooldown before showing again).
alter table bookings add column if not exists review_prompt_dismiss_count integer not null default 0;
alter table bookings add column if not exists review_prompt_dismissed_at timestamptz;

create or replace function submit_review(p_booking_id uuid, p_rating integer, p_comment text)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_camera_id uuid;
  v_customer_name text;
  v_review_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  -- Ownership + eligibility in one guarded select, same shape as
  -- activate_booking/complete_booking's "UPDATE ... WHERE ... ; IF NOT FOUND".
  select camera_id into v_camera_id
  from bookings
  where id = p_booking_id
    and customer_id = auth.uid()
    and status = 'completed';

  if not found then
    raise exception 'This booking is not eligible for a review.';
  end if;

  if exists (select 1 from reviews where booking_id = p_booking_id) then
    raise exception 'This booking has already been reviewed.';
  end if;

  -- The reviewer's actual account/login name — profiles.full_name, or
  -- their email if no name is set (the same fallback Navbar.jsx already
  -- uses for a signed-in customer's display name). Deliberately NOT the
  -- booking form's free-text customer_name — that field can hold anything
  -- the customer typed at request time, not necessarily their real name.
  select coalesce(nullif(trim(full_name), ''), email) into v_customer_name
  from profiles
  where id = auth.uid();

  insert into reviews (booking_id, camera_id, customer_id, customer_name, rating, comment)
  values (
    p_booking_id, v_camera_id, auth.uid(),
    coalesce(v_customer_name, 'Verified Renter'),
    p_rating, nullif(trim(p_comment), '')
  )
  returning id into v_review_id;

  return v_review_id;
end;
$$;

revoke all on function submit_review(uuid, integer, text) from public;
grant execute on function submit_review(uuid, integer, text) to authenticated;

-- One-time backfill so reviews submitted before this change (which stored
-- the booking form's free-text customer_name) pick up the reviewer's real
-- account name too, without needing to be resubmitted. Safe to replay.
update reviews r
set customer_name = coalesce(nullif(trim(p.full_name), ''), p.email)
from profiles p
where p.id = r.customer_id;

create or replace function dismiss_review_prompt(p_booking_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  update bookings
  set review_prompt_dismiss_count = review_prompt_dismiss_count + 1,
      review_prompt_dismissed_at = now()
  where id = p_booking_id
    and customer_id = auth.uid()
    and status = 'completed';

  if not found then
    raise exception 'Booking not found or not eligible.';
  end if;
end;
$$;

revoke all on function dismiss_review_prompt(uuid) from public;
grant execute on function dismiss_review_prompt(uuid) to authenticated;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews'
  ) then
    alter publication supabase_realtime add table reviews;
  end if;
end $$;
