-- One shared approval path for the customer, agent, finance, and admin portals.
-- All policies use the role from public.profiles; no browser-supplied role is trusted.

alter table public.profiles
  drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('pending', 'active', 'approved', 'rejected', 'suspended'));

-- A user must always be able to read their own profile to complete sign-in.
drop policy if exists "users manage their profile" on public.profiles;
create policy "users manage their profile" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Admin and operations staff need to list and approve registrations.  This was
-- missing from the shared migration set, which left registrations invisible in
-- the admin portal under RLS.
drop policy if exists "portal managers manage profiles" on public.profiles;
create policy "portal managers manage profiles" on public.profiles for all to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]))
  with check (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]));

-- Keep a customer account and its profile in the same approval state whenever
-- the full operations schema is installed.
do $$
begin
  if to_regclass('public.customers') is not null then
    execute 'create or replace function public.sync_customer_profile_approval()
      returns trigger language plpgsql security definer set search_path = public as $fn$
      begin
        if new.email is not null then
          update public.profiles
             set account_status = case
               when new.status::text = ''active'' then ''approved''
               when new.status::text in (''inactive'', ''suspended'') then ''suspended''
               else ''pending'' end,
                 updated_at = now()
           where lower(email) = lower(new.email);
        end if;
        return new;
      end;
      $fn$';
    execute 'drop trigger if exists customer_profile_approval_sync on public.customers';
    execute 'create trigger customer_profile_approval_sync after insert or update of status, email on public.customers for each row execute function public.sync_customer_profile_approval()';
  end if;
end $$;

notify pgrst, 'reload schema';
