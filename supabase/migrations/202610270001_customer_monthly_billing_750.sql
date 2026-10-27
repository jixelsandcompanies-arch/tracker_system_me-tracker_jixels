-- Set the customer monthly instalment to KSh 750 for current and new plans.
alter table public.screening_applications
  alter column monthly_service_amount set default 750,
  add column if not exists monthly_service_started_at timestamptz;

update public.screening_applications
set monthly_service_amount = 750
where monthly_service_amount = 700;

-- Give existing approved customers one full billing month from rollout before
-- the automatic access restriction starts. New approvals start their cycle
-- from the approval timestamp written by the API.
update public.screening_applications
set monthly_service_started_at = now()
where status = 'approved' and monthly_service_started_at is null;

notify pgrst, 'reload schema';
