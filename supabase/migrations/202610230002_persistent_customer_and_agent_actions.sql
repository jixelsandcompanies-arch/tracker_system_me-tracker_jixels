alter table public.screening_applications
  add column if not exists tracker_installed_at timestamptz;

create table if not exists public.agent_alert_states (
  agent_id uuid not null references public.profiles(id) on delete cascade,
  alert_id text not null,
  read_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (agent_id, alert_id)
);

alter table public.agent_alert_states enable row level security;

create table if not exists public.customer_payment_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, payment_id)
);

alter table public.customer_payment_dismissals enable row level security;
