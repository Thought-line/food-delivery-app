-- Documents the CREATE TABLE definition for cameras as it exists on the
-- live database. Columns, types, nullability, and defaults verified
-- directly against information_schema.columns on the live project.
--
-- This table was originally created by hand in the Supabase SQL Editor,
-- before this repo's migration history started.

create table if not exists cameras (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text,
  status text not null default 'active'::text,
  image_url text,
  stock_quantity integer not null default 1,
  price numeric not null default 0
);
