-- Align the shared database with every table read by the Jixels Admin portal.
-- This migration is additive and is safe to run on an already-populated project.

create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(), full_name text not null,
  email text, phone text, national_id text, address text, county text, town text,
  tracker_number text, status text not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.bikes (
  id uuid primary key default gen_random_uuid(), identifier text not null unique,
  model text not null default 'Unspecified', product_type text not null default 'bike',
  custom_product_type text, payable_amount numeric(12,2) not null default 0,
  customer_id uuid references public.customers(id) on delete set null,
  assigned_agent_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trackers (
  id uuid primary key default gen_random_uuid(), identifier text not null unique,
  bike_id uuid references public.bikes(id) on delete set null, last_seen_at timestamptz,
  is_online boolean not null default false, operational_status text not null default 'offline',
  device_condition text not null default 'normal', latitude numeric, longitude numeric,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers(id) on delete set null,
  product_id uuid references public.bikes(id) on delete set null, amount numeric(12,2) not null default 0,
  currency text not null default 'KES', status text not null default 'pending', paid_at timestamptz,
  receipt_number text, created_at timestamptz not null default now()
);

create table if not exists public.screening_applications (
  id uuid primary key default gen_random_uuid(), full_name text not null, email text, phone text,
  customer_id uuid references public.customers(id) on delete set null,
  product_id uuid references public.bikes(id) on delete set null, installer_agent_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending', national_id text, tracker_identifier text,
  deposit_amount numeric(12,2) not null default 0, reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz, approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(), title text not null, notes text, priority text not null default 'normal',
  status text not null default 'open', customer_id uuid references public.customers(id) on delete set null,
  product_id uuid references public.bikes(id) on delete set null, tracker_id uuid references public.trackers(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null, assigned_to uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.support_case_history (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.support_cases(id) on delete cascade,
  action text not null, note text, actor_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);

create table if not exists public.workspace_settings (
  id uuid primary key default gen_random_uuid(), key text not null unique, value text not null, updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null,
  action text not null, resource text not null, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

alter table public.alerts add column if not exists kind text;
alter table public.alerts add column if not exists detail text;
alter table public.alerts add column if not exists resolved_at timestamptz;
alter table public.finance_accounts add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.finance_accounts add column if not exists outstanding numeric(12,2) not null default 0;
alter table public.finance_accounts add column if not exists status text not null default 'active';
alter table public.finance_accounts add column if not exists due_at timestamptz;

do $$ declare table_name text; begin
  foreach table_name in array array['customers','bikes','trackers','payments','screening_applications','support_cases','support_case_history','workspace_settings','audit_logs','finance_accounts','alerts'] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- The admin UI only reads and mutates records permitted by the signed-in role.
drop policy if exists "admin workspace read customers" on public.customers;
create policy "admin workspace read customers" on public.customers for select to authenticated using (public.has_role(array['admin','super_admin','operations_manager','finance','finance_officer','support_agent','read_only_auditor']::public.app_role[]));
drop policy if exists "admin workspace manage customers" on public.customers;
create policy "admin workspace manage customers" on public.customers for all to authenticated using (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[])) with check (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]));

do $$ declare table_name text; begin
  foreach table_name in array array['bikes','trackers','screening_applications','support_cases','support_case_history','alerts','audit_logs','workspace_settings'] loop
    execute format('drop policy if exists "admin workspace access" on public.%I', table_name);
    execute format('create policy "admin workspace access" on public.%I for all to authenticated using (public.has_role(array[''admin'',''super_admin'',''operations_manager'',''support_agent'']::public.app_role[])) with check (public.has_role(array[''admin'',''super_admin'',''operations_manager'',''support_agent'']::public.app_role[]))', table_name);
  end loop;
end $$;

drop policy if exists "admin workspace finance access" on public.payments;
create policy "admin workspace finance access" on public.payments for all to authenticated using (public.has_role(array['admin','super_admin','operations_manager','finance','finance_officer','read_only_auditor']::public.app_role[])) with check (public.has_role(array['admin','super_admin','operations_manager','finance','finance_officer']::public.app_role[]));

notify pgrst, 'reload schema';
