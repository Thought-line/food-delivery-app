-- Documents the CREATE TABLE definition for bookings as it exists on the
-- live database. Columns, types, nullability, and defaults verified
-- directly against information_schema.columns on the live project.
--
-- This table was originally created by hand in the Supabase SQL Editor,
-- before this repo's migration history started: the oldest tracked
-- migration, 20260812000000_stock_aware_booking_conflicts.sql, already does
-- `ALTER TABLE bookings` on day one, meaning the table pre-dates it.
--
-- Depends on profiles (20260819051000_profiles_table.sql) and cameras
-- (20260819052000_cameras_table.sql) already existing, for the foreign keys
-- below.
--
-- Two things below are INFERRED, not directly queried, and worth
-- double-checking later if exact accuracy matters:
--   1. The foreign keys themselves (camera_id -> cameras.id, customer_id ->
--      profiles.id) — not optional guesses though: the app's existing
--      PostgREST embedded-select syntax (e.g. `cameras(name, price)` and
--      `profiles:customer_id(email)` in AdminPanel.jsx) only works at all if
--      these foreign keys genuinely exist. Exact constraint names/ON DELETE
--      behavior are assumed.
--   2. The bookings_quantity_positive CHECK constraint, carried over from
--      20260812020000_quantity_and_price.sql.

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references cameras (id),
  customer_id uuid not null references profiles (id),
  start_date date not null,
  end_date date not null,
  status text not null default 'requested'::text,
  created_at timestamptz default now(),
  customer_name text,
  customer_location text,
  customer_phone text,
  pickup_reminder_sent boolean not null default false,
  return_reminder_sent boolean not null default false,
  quantity integer not null default 1,
  constraint bookings_quantity_positive check (quantity > 0)
);
