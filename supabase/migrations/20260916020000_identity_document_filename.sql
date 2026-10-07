
alter table profiles add column if not exists identity_document_filename text;
drop function if exists update_my_identity_document(text, text);

create function update_my_identity_document(
  p_document_type text,
  p_document_path text,
  p_document_filename text
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
      identity_document_filename = p_document_filename,
      identity_document_submitted_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function update_my_identity_document(text, text, text) from public;
grant execute on function update_my_identity_document(text, text, text) to authenticated;
