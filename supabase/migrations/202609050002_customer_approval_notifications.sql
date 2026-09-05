-- Device tokens are bound during customer registration and are only accessed
-- by the server-side approval workflow. They are never exposed to agents or
-- other customers.
create table if not exists public.customer_push_tokens (
  customer_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  primary key (customer_id, expo_push_token)
);

alter table public.customer_push_tokens enable row level security;

notify pgrst, 'reload schema';
