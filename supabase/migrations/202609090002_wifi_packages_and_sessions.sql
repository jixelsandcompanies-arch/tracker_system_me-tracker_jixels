-- Rural Wi-Fi prepaid package catalogue and gateway sessions.
create table if not exists public.wifi_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  price_kes numeric(12,2) not null check (price_kes > 0),
  duration_minutes integer not null check (duration_minutes > 0),
  description text not null default '',
  is_active boolean not null default true,
  is_popular boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wifi_purchases (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.wifi_packages(id),
  phone text not null,
  device_mac text,
  amount_kes numeric(12,2) not null check (amount_kes > 0),
  idempotency_key text not null unique,
  checkout_request_id text unique,
  mpesa_receipt text unique,
  status text not null default 'pending' check (status in ('pending','completed','failed','expired')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.wifi_sessions (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.wifi_purchases(id) on delete cascade,
  package_id uuid not null references public.wifi_packages(id),
  phone text not null,
  device_mac text,
  status text not null default 'pending' check (status in ('pending','active','expired','revoked','gateway_failed')),
  starts_at timestamptz,
  expires_at timestamptz,
  gateway_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.wifi_packages (name, slug, price_kes, duration_minutes, description, is_active, is_popular, display_order)
values
  ('1 Hour', '1-hour', 10, 60, 'Unlimited Wi-Fi for 1 hour', true, false, 1),
  ('1.5 Hours', '1-5-hours', 15, 90, 'Unlimited Wi-Fi for 1 hour 30 minutes', true, false, 2),
  ('4 Hours', '4-hours', 20, 240, 'Unlimited Wi-Fi for 4 hours', true, false, 3),
  ('6 Hours', '6-hours', 30, 360, 'Unlimited Wi-Fi for 6 hours', true, false, 4),
  ('12 Hours', '12-hours', 60, 720, 'Unlimited Wi-Fi for 12 hours', true, true, 5),
  ('24 Hours', '24-hours', 80, 1440, 'Unlimited Wi-Fi for 24 hours', true, false, 6),
  ('7 Days / Weekly', 'weekly', 400, 10080, 'Unlimited Wi-Fi for 7 days', true, false, 7),
  ('30 Days / Monthly', 'monthly', 800, 43200, 'Unlimited Wi-Fi for 30 days', true, false, 8)
on conflict (slug) do update set name = excluded.name, price_kes = excluded.price_kes, duration_minutes = excluded.duration_minutes, description = excluded.description, updated_at = now();

create index if not exists wifi_sessions_expiry_idx on public.wifi_sessions(status, expires_at);
create index if not exists wifi_purchases_phone_idx on public.wifi_purchases(phone, created_at desc);

alter table public.wifi_packages enable row level security;
alter table public.wifi_purchases enable row level security;
alter table public.wifi_sessions enable row level security;
drop policy if exists "public read active wifi packages" on public.wifi_packages;
create policy "public read active wifi packages" on public.wifi_packages for select to anon, authenticated using (is_active = true);
drop policy if exists "admin manage wifi packages" on public.wifi_packages;
create policy "admin manage wifi packages" on public.wifi_packages for all to authenticated using (public.has_role(array['admin','super_admin','operations_manager','finance','finance_officer']::public.app_role[])) with check (public.has_role(array['admin','super_admin','operations_manager','finance','finance_officer']::public.app_role[]));

create or replace function public.expire_wifi_sessions()
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  update public.wifi_sessions set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();
  get diagnostics changed = row_count;
  return changed;
end; $$;

notify pgrst, 'reload schema';
