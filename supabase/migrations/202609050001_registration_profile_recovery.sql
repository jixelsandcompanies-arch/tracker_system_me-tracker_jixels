-- Registration must be able to provision a profile on both new and existing
-- projects. The portal API records profile updates, while earlier schemas did
-- not consistently include this audit column.
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

update public.profiles
   set updated_at = now()
 where updated_at is null;

-- This trigger used to be installed before the customers table was created on
-- a fresh project. Install it after the complete workspace schema so approving
-- a customer always activates the matching login profile.
create or replace function public.sync_customer_profile_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null then
    update public.profiles
       set account_status = case
             when new.status::text = 'active' then 'approved'
             when new.status::text in ('inactive', 'suspended') then 'suspended'
             else 'pending'
           end,
           updated_at = now()
     where lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists customer_profile_approval_sync on public.customers;
create trigger customer_profile_approval_sync
after insert or update of status, email on public.customers
for each row execute function public.sync_customer_profile_approval();

notify pgrst, 'reload schema';
