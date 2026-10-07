-- Per-customer camera wishlist ("save for later"). Gated behind login the
-- same way booking/cart already are — useAuthGate.requireAuth() on the
-- frontend pops the login prompt before any wishlist call is made; this
-- migration is the server-side half, restricting reads/writes to each row's
-- own owner via RLS. No admin or public read — a wishlist is personal.
--
-- Paste into the Supabase SQL editor and run. Idempotent / safe to replay.
--
-- ON DELETE CASCADE on both foreign keys is a deliberate departure from the
-- rest of this schema (bookings' FKs have no cascade — see
-- 20260819053000_bookings_table.sql): a wishlist entry is disposable, so a
-- deleted profile or a hard-deleted camera should just silently drop it
-- rather than blocking the delete the way booking history does.

create table if not exists wishlists (
  user_id uuid not null references profiles (id) on delete cascade,
  camera_id uuid not null references cameras (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, camera_id)
);

alter table wishlists enable row level security;

drop policy if exists wishlists_select_own on wishlists;
create policy wishlists_select_own on wishlists
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists wishlists_insert_own on wishlists;
create policy wishlists_insert_own on wishlists
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists wishlists_delete_own on wishlists;
create policy wishlists_delete_own on wishlists
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No anon use case for a personal wishlist — belt-and-braces alongside RLS,
-- matching the explicit-revoke style used for cameras/bookings in
-- 20260902000000_public_browse_and_booking_auth.sql.
revoke all on wishlists from anon;
