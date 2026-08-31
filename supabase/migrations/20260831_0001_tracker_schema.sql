-- Jixels tracker application schema for Supabase PostgreSQL.
-- Run through `supabase db push` or paste into the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  registration text not null,
  model text not null,
  vehicle_type text not null default 'motorcycle' check (vehicle_type in ('motorcycle', 'car', 'tuk_tuk')),
  tracker_imei text unique,
  monitoring_armed boolean not null default false,
  immobilized boolean not null default false,
  created_at timestamptz not null default now(),
  unique(owner_id, registration)
);

create table if not exists public.tracker_locations (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  speed_kph numeric(7,2) not null default 0 check (speed_kph >= 0),
  heading numeric(6,2),
  accuracy_meters numeric(8,2),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists tracker_locations_vehicle_recorded_idx on public.tracker_locations(vehicle_id, recorded_at desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  title text not null,
  body text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  idempotency_key text not null unique,
  provider text not null default 'mpesa',
  provider_reference text,
  amount numeric(12,2) not null check (amount > 0),
  phone text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.tracker_locations enable row level security;
alter table public.alerts enable row level security;
alter table public.payment_requests enable row level security;

create policy "users manage their profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "users manage their vehicles" on public.vehicles for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "users read their vehicle locations" on public.tracker_locations for select using (exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = auth.uid()));
create policy "users manage their alerts" on public.alerts for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "users read their payments" on public.payment_requests for select using (owner_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
