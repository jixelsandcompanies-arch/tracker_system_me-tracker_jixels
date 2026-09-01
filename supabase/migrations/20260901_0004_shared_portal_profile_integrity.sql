-- Shared profile integrity for Customer, Agent, Finance and Admin portals.
-- This migration is deliberately additive: it reconciles the independently
-- developed portal schemas without disabling RLS or trusting browser metadata.

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists account_status text not null default 'active';
create unique index if not exists profiles_email_unique_idx on public.profiles (lower(email)) where email is not null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone, role, account_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    'customer'::public.app_role,
    'active'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    phone = coalesce(public.profiles.phone, excluded.phone),
    updated_at = now();
  return new;
end;
$$;

-- Applied profiles must exist before any portal can authorize a session.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Ensure the Finance portal's audit dependency exists on every deployment and
-- force PostgREST to reload the new schema after `supabase db push`.
create table if not exists public.finance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.finance_audit_logs enable row level security;
drop policy if exists "finance staff read" on public.finance_audit_logs;
drop policy if exists "finance staff write" on public.finance_audit_logs;
create policy "finance staff read" on public.finance_audit_logs for select
  using (public.has_role(array['finance','finance_officer','admin','super_admin']::public.app_role[]));
create policy "finance staff write" on public.finance_audit_logs for all
  using (public.has_role(array['finance','finance_officer','admin','super_admin']::public.app_role[]))
  with check (public.has_role(array['finance','finance_officer','admin','super_admin']::public.app_role[]));

notify pgrst, 'reload schema';
