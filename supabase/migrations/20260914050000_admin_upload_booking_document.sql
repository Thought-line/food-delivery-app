
drop policy if exists identity_documents_insert_admin_upload on storage.objects;
create policy identity_documents_insert_admin_upload on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = 'admin-uploads'
    and (select role from profiles where id = auth.uid()) = 'admin'
  );
create or replace function admin_set_booking_document(
  p_booking_id uuid,
  p_document_type text,
  p_document_path text
)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then
    raise exception 'only admins can set a booking''s identity document';
  end if;

  if p_document_type not in ('aadhaar', 'driving_licence', 'pan', 'passport', 'other') then
    raise exception 'invalid document type';
  end if;

  if p_document_path is null or trim(p_document_path) = '' then
    raise exception 'document path is required';
  end if;

  update bookings
  set identity_document_type = p_document_type,
      identity_document_url = p_document_path
  where id = p_booking_id;

  if not found then
    raise exception 'booking not found';
  end if;
end;
$$;
revoke all on function admin_set_booking_document(uuid, text, text) from public;
grant execute on function admin_set_booking_document(uuid, text, text) to authenticated;
