alter table bookings add column if not exists handover_proof_url text;
drop policy if exists identity_documents_insert_handover_proof on storage.objects;
create policy identity_documents_insert_handover_proof on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = 'handover-proofs'
    and (select role from profiles where id = auth.uid()) = 'admin'
  );
drop function if exists verify_booking_handover(uuid);
create or replace function verify_booking_handover(
  p_booking_id uuid,
  p_proof_url text default null
)
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
      handover_verified_by = auth.uid(),
      handover_proof_url = p_proof_url
  where id = p_booking_id;

  if not found then
    raise exception 'booking not found';
  end if;
end;
$$;

revoke all on function verify_booking_handover(uuid, text) from public;
grant execute on function verify_booking_handover(uuid, text) to authenticated;
