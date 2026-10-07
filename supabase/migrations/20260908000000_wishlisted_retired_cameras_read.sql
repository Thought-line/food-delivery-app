-- Lets a customer keep seeing a camera they've wishlisted even after an
-- admin retires it, instead of it silently disappearing from /wishlist.
-- Run this in the Supabase SQL editor. Idempotent / safe to replay.
-- Additive, on top of the existing cameras_public_read policy (Postgres
-- OR's multiple permissive policies together for the same command) — this
-- does not touch cameras_public_read, so browsing/search/cart/booking
-- visibility rules are unaffected. It only grants a signed-in customer
-- read access to a camera row (regardless of status) when that exact
-- camera is in *their own* wishlist — an anonymous visitor, or a different
-- customer's wishlist, still can't see a retired camera through this path.
drop policy if exists cameras_wishlisted_read on cameras;
create policy cameras_wishlisted_read on cameras
  for select
  to authenticated
  using (
    exists (
      select 1 from wishlists w
      where w.camera_id = cameras.id
        and w.user_id = auth.uid()
    )
  );
