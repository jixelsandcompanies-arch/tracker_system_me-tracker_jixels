-- Live support cases and actionable alert workflow.
create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.bikes(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  tracker_id uuid references public.trackers(id) on delete set null,
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists support_cases_updated_at on public.support_cases;
create trigger support_cases_updated_at before update on public.support_cases
for each row execute function public.touch_updated_at();

alter table public.support_cases enable row level security;
drop policy if exists "staff view support cases" on public.support_cases;
create policy "staff view support cases" on public.support_cases for select to authenticated
using (public.current_role() is not null);
drop policy if exists "staff manage support cases" on public.support_cases;
create policy "staff manage support cases" on public.support_cases for all to authenticated
using (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'))
with check (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'));

alter table public.alerts add column if not exists acknowledged_at timestamptz;
alter table public.alerts add column if not exists acknowledged_by uuid references public.profiles(id) on delete set null;
alter table public.alerts add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.support_cases add column if not exists notes text;

create index if not exists support_cases_status_created_idx on public.support_cases (status, created_at desc);
create index if not exists alerts_open_created_idx on public.alerts (created_at desc) where resolved_at is null;
