-- Connected operational records, notification events, and UI-aligned RLS.
create table if not exists public.support_case_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  action text not null,
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists support_case_history_case_created_idx on public.support_case_history(case_id, created_at desc);
alter table public.support_case_history enable row level security;

-- The app exposes case operations to operations/support staff and history read access
-- to the same people. Finance and audit users see neither page.
drop policy if exists "case staff view history" on public.support_case_history;
create policy "case staff view history" on public.support_case_history for select to authenticated
using (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'));
drop policy if exists "case staff add history" on public.support_case_history;
create policy "case staff add history" on public.support_case_history for insert to authenticated
with check (public.current_role() in ('super_admin', 'operations_manager', 'support_agent') and (actor_id is null or actor_id = auth.uid()));

-- Assignee names are required by the case page for the same roles that can see it.
drop policy if exists "case staff view profiles" on public.profiles;
create policy "case staff view profiles" on public.profiles for select to authenticated
using (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'));

-- Notifications are persisted as alerts so every authorized session receives the
-- same events through the existing realtime subscription.
create or replace function public.notify_new_support_case()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.alerts(kind, title, detail, severity)
  values ('support_case', 'New support case', new.title, case when new.priority in ('high', 'urgent') then 'warning' else 'info' end);
  return new;
end; $$;
drop trigger if exists support_case_created_alert on public.support_cases;
create trigger support_case_created_alert after insert on public.support_cases
for each row execute function public.notify_new_support_case();

create or replace function public.notify_tracker_offline()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_online and not new.is_online then
    insert into public.alerts(kind, title, detail, severity)
    values ('tracker_offline', 'Tracker offline', new.identifier, 'warning');
  end if;
  return new;
end; $$;
drop trigger if exists tracker_offline_alert on public.trackers;
create trigger tracker_offline_alert after update of is_online on public.trackers
for each row execute function public.notify_tracker_offline();

create or replace function public.notify_screening_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'declined') and old.status is distinct from new.status then
    insert into public.alerts(kind, title, detail, severity)
    values ('screening_decision', 'Screening ' || new.status, new.full_name, case when new.status = 'declined' then 'warning' else 'info' end);
  end if;
  return new;
end; $$;
drop trigger if exists screening_decision_alert on public.screening_applications;
create trigger screening_decision_alert after update of status on public.screening_applications
for each row execute function public.notify_screening_decision();

-- Align selectable records with navigation: finance has customer identity but not
-- product/trackers/cases, while operations/support have operational records.
drop policy if exists "staff view customers" on public.customers;
create policy "staff view customers" on public.customers for select to authenticated
using (public.current_role() in ('super_admin','operations_manager','finance_officer','support_agent'));
drop policy if exists "staff view bikes" on public.bikes;
create policy "staff view bikes" on public.bikes for select to authenticated
using (public.current_role() in ('super_admin','operations_manager','support_agent'));
drop policy if exists "staff view trackers" on public.trackers;
create policy "staff view trackers" on public.trackers for select to authenticated
using (public.current_role() in ('super_admin','operations_manager','support_agent'));
drop policy if exists "staff view screening" on public.screening_applications;
create policy "staff view screening" on public.screening_applications for select to authenticated
using (public.current_role() in ('super_admin','operations_manager','support_agent'));
drop policy if exists "staff view support cases" on public.support_cases;
create policy "staff view support cases" on public.support_cases for select to authenticated
using (public.current_role() in ('super_admin','operations_manager','support_agent'));
drop policy if exists "staff view alerts" on public.alerts;
create policy "staff view alerts" on public.alerts for select to authenticated
using (public.current_role() in ('super_admin','operations_manager','support_agent'));
drop policy if exists "staff read reports" on public.reports;
create policy "staff read reports" on public.reports for select to authenticated
using (public.current_role() in ('super_admin','operations_manager','finance_officer','read_only_auditor'));

-- Explicitly allow the workflows exposed by the UI.
drop policy if exists "staff create support cases" on public.support_cases;
create policy "staff create support cases" on public.support_cases for insert to authenticated
with check (public.current_role() in ('super_admin','operations_manager','support_agent'));
