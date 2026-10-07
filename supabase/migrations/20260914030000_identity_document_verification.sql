-- Identity document upload (customer profile) + handover verification
-- (admin booking details). No automatic/KYC verification anywhere here —
-- verification is a manual admin action taken in person at handover.
--
-- Storage: a NEW private bucket, 'identity-documents' (unlike the existing
-- public 'camera-photos' bucket, created by hand in the dashboard — this
-- one is provisioned here since storage.buckets is a plain table). Objects
-- are stored at '<user_id>/<filename>' so the RLS policies below can scope
-- access by folder-matches-auth.uid(). identity_document_url columns below
-- store that STORAGE PATH (not a public URL, since the bucket isn't public)
-- — resolve to a real URL on demand via createSignedUrl().
--
-- Run this in the Supabase SQL editor. Idempotent / safe to replay.

-- 1. profiles — the customer's current document on file ------------------
alter table profiles add column if not exists identity_document_url text;
alter table profiles add column if not exists identity_document_type text;
alter table profiles add column if not exists identity_document_submitted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_identity_document_type_valid') then
    alter table profiles add constraint profiles_identity_document_type_valid
      check (identity_document_type in ('aadhaar', 'driving_licence', 'pan', 'passport', 'other'));
  end if;
end $$;

-- 2. bookings — a snapshot of the document as it was when this booking was
--    made, plus this specific booking's own handover-verification state.
alter table bookings add column if not exists identity_document_url text;
alter table bookings add column if not exists identity_document_type text;
alter table bookings add column if not exists handover_verified boolean not null default false;
alter table bookings add column if not exists handover_verified_at timestamptz;
alter table bookings add column if not exists handover_verified_by uuid references profiles (id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_identity_document_type_valid') then
    alter table bookings add constraint bookings_identity_document_type_valid
      check (identity_document_type in ('aadhaar', 'driving_licence', 'pan', 'passport', 'other'));
  end if;
end $$;

-- 3. Storage bucket + RLS --------------------------------------------------
insert into storage.buckets (id, name, public)
values ('identity-documents', 'identity-documents', false)
on conflict (id) do nothing;

-- A customer can upload/replace only their own document — objects are
-- stored at '<auth.uid()>/<filename>', checked via storage.foldername()
-- (Supabase's built-in helper that splits an object path into folder
-- segments).
drop policy if exists identity_documents_insert_own on storage.objects;
create policy identity_documents_insert_own on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists identity_documents_update_own on storage.objects;
create policy identity_documents_update_own on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A customer can read only their own document; an admin can read any
-- document in this bucket (needed for "View Document" + createSignedUrl,
-- which is itself gated by this same SELECT policy).
drop policy if exists identity_documents_select_own_or_admin on storage.objects;
create policy identity_documents_select_own_or_admin on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'identity-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (select role from profiles where id = auth.uid()) = 'admin'
    )
  );

-- 4. update_my_identity_document() — customer submits/replaces their own
--    document. SECURITY DEFINER, only ever touches auth.uid()'s own row.
create or replace function update_my_identity_document(
  p_document_type text,
  p_document_path text
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

  if p_document_type not in ('aadhaar', 'driving_licence', 'pan', 'passport', 'other') then
    raise exception 'invalid document type';
  end if;

  if p_document_path is null or trim(p_document_path) = '' then
    raise exception 'document path is required';
  end if;

  update profiles
  set identity_document_type = p_document_type,
      identity_document_url = p_document_path,
      identity_document_submitted_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function update_my_identity_document(text, text) from public;
grant execute on function update_my_identity_document(text, text) to authenticated;

-- 5. create_booking_hold() — unchanged signature, redefined body only to
--    snapshot the caller's current identity document onto the new booking
--    row (read server-side via auth.uid(), never trusted from the client).
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
  v_identity_document_url text;
  v_identity_document_type text;
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

  -- Snapshot whatever identity document is currently on the customer's
  -- profile onto this booking, so an admin reviewing THIS booking always
  -- sees the document that was on file when it was made, even if the
  -- customer later replaces it on their profile.
  select identity_document_url, identity_document_type
    into v_identity_document_url, v_identity_document_type
    from profiles
    where id = auth.uid();

  -- The BEFORE INSERT trigger check_camera_stock_availability() runs here and
  -- RAISEs 'no_overlapping_confirmed_bookings: ...' if the dates are full.
  insert into bookings (
    camera_id, start_date, end_date,
    customer_name, customer_location, customer_phone,
    customer_id, status, quantity,
    payment_status, amount_total, amount_paid, hold_expires_at,
    identity_document_url, identity_document_type
  ) values (
    p_camera_id, p_start, p_end,
    p_name, p_location, p_phone,
    auth.uid(), 'confirmed', p_quantity,
    'pending', coalesce(p_amount_total, 0), 0, now() + interval '15 minutes',
    v_identity_document_url, v_identity_document_type
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function create_booking_hold(uuid, date, date, text, text, text, integer, numeric) from public;
grant execute on function create_booking_hold(uuid, date, date, text, text, text, integer, numeric) to authenticated;

-- 6. verify_booking_handover() — admin confirms the physically-presented ID
--    matches the uploaded document. Purely a manual record: no automatic/
--    KYC verification, no third-party service, ever.
create or replace function verify_booking_handover(p_booking_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'only admins can verify handover';
  end if;

  update bookings
  set handover_verified = true,
      handover_verified_at = now(),
      handover_verified_by = auth.uid()
  where id = p_booking_id;

  if not found then
    raise exception 'booking not found';
  end if;
end;
$$;

revoke all on function verify_booking_handover(uuid) from public;
grant execute on function verify_booking_handover(uuid) to authenticated;
