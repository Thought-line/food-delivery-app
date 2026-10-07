-- Adds phone + location ("address" in the UI — used only to verify who's
-- picking up the camera; this business doesn't deliver) to profiles, plus a
-- SECURITY DEFINER RPC for a customer to update their own name/phone/
-- location. Lets ProfilePage.jsx save these once instead of the customer
-- retyping them on every single booking (see useProfileContactDefaults.js,
-- which pre-fills BookingForm/CartPage's contact fields from here).
--
-- Uses a SECURITY DEFINER RPC rather than a profiles UPDATE RLS policy
-- because this table's original RLS setup predates this repo's migration
-- history and isn't fully documented here (see 20260819051000_profiles_table.sql) —
-- this way the update is safe (only ever touches auth.uid()'s own row, never
-- role/email) regardless of whatever RLS already exists on the table.
--
-- Run this in the Supabase SQL editor. Idempotent / safe to replay.

alter table profiles add column if not exists phone text;
alter table profiles add column if not exists location text;

create or replace function update_my_profile(
  p_full_name text,
  p_phone text,
  p_location text
)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update profiles
  set full_name = nullif(trim(p_full_name), ''),
      phone = nullif(trim(p_phone), ''),
      location = nullif(trim(p_location), '')
  where id = auth.uid();
end;
$$;

revoke all on function update_my_profile(text, text, text) from public;
grant execute on function update_my_profile(text, text, text) to authenticated;
