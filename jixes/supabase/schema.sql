-- Jixels Admin data model. Run in Supabase SQL Editor before enabling live data.
create extension if not exists pgcrypto;

create type public.app_role as enum ('super_admin', 'operations_manager', 'finance_officer', 'support_agent', 'read_only_auditor');
create type public.record_status as enum ('active', 'inactive', 'pending', 'suspended');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Administrator',
  email text,
  phone text,
  role public.app_role not null default 'support_agent',
  account_status text not null default 'pending' check (account_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  national_id text,
  address text,
  county text,
  town text,
  tracker_number text,
  status public.record_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bikes (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique,
  model text not null,
  product_type text not null default 'bike' check (product_type in ('bike', 'car', 'tuktuk', 'device', 'other')),
  custom_product_type text,
  payable_amount numeric(12, 2) not null default 0 check (payable_amount >= 0),
  customer_id uuid references public.customers(id) on delete set null,
  assigned_agent_id uuid references public.profiles(id) on delete set null,
  location text,
  battery_percent integer check (battery_percent between 0 and 100),
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trackers (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique,
  bike_id uuid references public.bikes(id) on delete set null,
  last_seen_at timestamptz,
  is_online boolean not null default false,
  operational_status text not null default 'offline' check (operational_status in ('online', 'offline', 'immobilized')),
  device_condition text not null default 'normal' check (device_condition in ('normal', 'damaged', 'destroyed', 'tampered')),
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'KES',
  status public.record_status not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  principal numeric(12, 2) not null check (principal >= 0),
  outstanding numeric(12, 2) not null check (outstanding >= 0),
  status public.record_status not null default 'active',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  detail text,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource text not null,
  resource_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.current_role() = required_role or public.current_role() = 'super_admin' $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at before update on public.customers for each row execute function public.touch_updated_at();
drop trigger if exists bikes_updated_at on public.bikes;
create trigger bikes_updated_at before update on public.bikes for each row execute function public.touch_updated_at();
drop trigger if exists trackers_updated_at on public.trackers;
create trigger trackers_updated_at before update on public.trackers for each row execute function public.touch_updated_at();
drop trigger if exists finance_accounts_updated_at on public.finance_accounts;
create trigger finance_accounts_updated_at before update on public.finance_accounts for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.bikes enable row level security;
alter table public.trackers enable row level security;
alter table public.payments enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.alerts enable row level security;
alter table public.audit_logs enable row level security;

create policy "users view own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.current_role() = 'super_admin');
create policy "admins manage profiles" on public.profiles for all to authenticated using (public.current_role() = 'super_admin') with check (public.current_role() = 'super_admin');
create policy "staff view customers" on public.customers for select to authenticated using (public.current_role() is not null);
create policy "operations manage customers" on public.customers for all to authenticated using (public.current_role() in ('super_admin', 'operations_manager')) with check (public.current_role() in ('super_admin', 'operations_manager'));
create policy "staff view bikes" on public.bikes for select to authenticated using (public.current_role() is not null);
create policy "operations manage bikes" on public.bikes for all to authenticated using (public.current_role() in ('super_admin', 'operations_manager', 'support_agent')) with check (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'));
create policy "staff view trackers" on public.trackers for select to authenticated using (public.current_role() is not null);
create policy "operations manage trackers" on public.trackers for all to authenticated using (public.current_role() in ('super_admin', 'operations_manager', 'support_agent')) with check (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'));
create policy "finance staff view payments" on public.payments for select to authenticated using (public.current_role() in ('super_admin', 'finance_officer', 'operations_manager', 'read_only_auditor'));
create policy "finance staff manage payments" on public.payments for all to authenticated using (public.current_role() in ('super_admin', 'finance_officer')) with check (public.current_role() in ('super_admin', 'finance_officer'));
create policy "finance staff view accounts" on public.finance_accounts for select to authenticated using (public.current_role() in ('super_admin', 'finance_officer', 'operations_manager', 'read_only_auditor'));
create policy "finance staff manage accounts" on public.finance_accounts for all to authenticated using (public.current_role() in ('super_admin', 'finance_officer')) with check (public.current_role() in ('super_admin', 'finance_officer'));
create policy "staff view alerts" on public.alerts for select to authenticated using (public.current_role() is not null);
create policy "staff resolve alerts" on public.alerts for update to authenticated using (public.current_role() in ('super_admin', 'operations_manager', 'support_agent')) with check (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'));
create policy "staff view audit logs" on public.audit_logs for select to authenticated using (public.current_role() in ('super_admin', 'read_only_auditor'));
create policy "authenticated append audit logs" on public.audit_logs for insert to authenticated with check (actor_id = auth.uid());

revoke update, delete on public.audit_logs from authenticated;
revoke all on public.profiles, public.customers, public.bikes, public.trackers, public.payments, public.finance_accounts, public.alerts, public.audit_logs from anon;

-- Operational modules, realtime support chat, and tracker ingestion.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Support desk',
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(), name text not null, owner text,
  period_start date, period_end date, status text not null default 'processing', created_at timestamptz not null default now()
);
create table if not exists public.service_status (
  id uuid primary key default gen_random_uuid(), service_name text not null unique, latency_ms integer,
  uptime_percent numeric(5,2), status text not null default 'operational', created_at timestamptz not null default now()
);
create table if not exists public.workspace_settings (
  id uuid primary key default gen_random_uuid(), key text not null unique, value text not null,
  updated_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
alter table public.reports enable row level security;
alter table public.service_status enable row level security;
alter table public.workspace_settings enable row level security;
create policy "staff read support chat" on public.chat_messages for select to authenticated using (public.current_role() is not null);
create policy "staff send support chat" on public.chat_messages for insert to authenticated with check (sender_id = auth.uid() and public.current_role() is not null);
create policy "staff read reports" on public.reports for select to authenticated using (public.current_role() is not null);
create policy "admins manage reports" on public.reports for all to authenticated using (public.current_role() in ('super_admin','operations_manager','finance_officer')) with check (public.current_role() in ('super_admin','operations_manager','finance_officer'));
create policy "staff read service status" on public.service_status for select to authenticated using (public.current_role() is not null);
create policy "admins manage service status" on public.service_status for all to authenticated using (public.current_role() = 'super_admin') with check (public.current_role() = 'super_admin');
create policy "staff read settings" on public.workspace_settings for select to authenticated using (public.current_role() is not null);
create policy "admins manage settings" on public.workspace_settings for all to authenticated using (public.current_role() = 'super_admin') with check (public.current_role() = 'super_admin');
alter publication supabase_realtime add table public.chat_messages;

-- Called only by the tracker-heartbeat Edge Function using a service role.
create or replace function public.record_tracker_heartbeat(
  tracker_identifier text, tracker_latitude numeric, tracker_longitude numeric, tracker_battery integer default null
) returns public.trackers language plpgsql security definer set search_path = public as $$
declare updated_tracker public.trackers;
begin
  update public.trackers set last_seen_at = now(), is_online = true, latitude = tracker_latitude, longitude = tracker_longitude
  where identifier = tracker_identifier returning * into updated_tracker;
  if updated_tracker.id is null then raise exception 'Unknown tracker'; end if;
  if tracker_battery is not null and updated_tracker.bike_id is not null then update public.bikes set battery_percent = tracker_battery where id = updated_tracker.bike_id; end if;
  return updated_tracker;
end; $$;
revoke all on function public.record_tracker_heartbeat(text, numeric, numeric, integer) from public, anon, authenticated;
