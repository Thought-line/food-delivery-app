-- Documents the CREATE TABLE definition for profiles as it exists on the
-- live database. Columns, types, nullability, and defaults verified
-- directly against information_schema.columns on the live project.
--
-- This table was originally created by hand in the Supabase SQL Editor,
-- before this repo's migration history started.
--
-- id -> auth.users.id is inferred, not directly queried: profiles.id has no
-- default and no NULL rows are possible, matching the standard Supabase
-- pattern of a profile row keyed 1:1 to its auth.users row.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'customer'::text,
  created_at timestamptz default now()
);
