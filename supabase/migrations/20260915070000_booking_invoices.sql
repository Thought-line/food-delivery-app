alter table bookings add column if not exists invoice_path text;
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- A customer can read only their own invoices (stored at
-- '<customer_id>/<booking_id>.pdf'); an admin can read any. No INSERT policy
-- — only the Edge Function's service-role client ever writes here, and that
-- bypasses RLS entirely.
drop policy if exists invoices_select_own_or_admin on storage.objects;
create policy invoices_select_own_or_admin on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (select role from profiles where id = auth.uid()) = 'admin'
    )
  );
