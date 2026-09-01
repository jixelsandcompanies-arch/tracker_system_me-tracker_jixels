do $$ begin
  create type public.app_role as enum ('customer','agent','admin','finance','super_admin','operations_manager','finance_officer','support_agent','read_only_auditor');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role public.app_role not null default 'customer';
alter table public.profiles add column if not exists account_status text not null default 'active';
create index if not exists profiles_role_idx on public.profiles(role);

create or replace function public.current_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'customer'::public.app_role)
$$;
create or replace function public.has_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role() = any(roles)
$$;

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(), external_id text not null unique,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_payments (
  id uuid primary key default gen_random_uuid(), external_id text not null unique,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_agents (
  id uuid primary key default gen_random_uuid(), external_id text not null unique,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(), external_id text not null unique,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_audit_logs (
  id uuid primary key default gen_random_uuid(), external_id text not null unique,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_settings (
  id text primary key default 'default', data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['finance_accounts','finance_payments','finance_agents','finance_alerts','finance_audit_logs','finance_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "finance staff read" on public.%I', t);
    execute format('drop policy if exists "finance staff write" on public.%I', t);
    execute format('create policy "finance staff read" on public.%I for select using (public.has_role(array[''finance'',''finance_officer'',''admin'',''super_admin'']::public.app_role[]))', t);
    execute format('create policy "finance staff write" on public.%I for all using (public.has_role(array[''finance'',''finance_officer'',''admin'',''super_admin'']::public.app_role[])) with check (public.has_role(array[''finance'',''finance_officer'',''admin'',''super_admin'']::public.app_role[]))', t);
  end loop;
end $$;

-- The legacy finance_workspace_state table is intentionally retained during
-- migration for rollback; the application no longer reads or writes it.
