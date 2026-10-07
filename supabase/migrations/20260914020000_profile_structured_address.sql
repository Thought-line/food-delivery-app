alter table profiles drop column if exists location;
alter table profiles add column if not exists pincode text;
alter table profiles add column if not exists state text;
alter table profiles add column if not exists address_line text;
alter table profiles add column if not exists locality text;
alter table profiles add column if not exists city text;
drop function if exists update_my_profile(text, text, text);
create or replace function update_my_profile(
  p_full_name text,
  p_phone text,
  p_pincode text,
  p_state text,
  p_address_line text,
  p_locality text,
  p_city text
)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin4
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update profiles
  set full_name = nullif(trim(p_full_name), ''),
      phone = nullif(trim(p_phone), ''),
      pincode = nullif(trim(p_pincode), ''),
      state = nullif(trim(p_state), ''),
      address_line = nullif(trim(p_address_line), ''),
      locality = nullif(trim(p_locality), ''),
      city = nullif(trim(p_city), '')
  where id = auth.uid();
end;
$$;
revoke all on function update_my_profile(text, text, text, text, text, text, text) from public;
grant execute on function update_my_profile(text, text, text, text, text, text, text) to authenticated;
