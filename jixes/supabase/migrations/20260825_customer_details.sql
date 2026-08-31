alter table public.customers
  add column if not exists national_id text,
  add column if not exists address text,
  add column if not exists county text,
  add column if not exists town text,
  add column if not exists tracker_number text;

create index if not exists customers_national_id_idx on public.customers (national_id);
create index if not exists customers_tracker_number_idx on public.customers (tracker_number);
