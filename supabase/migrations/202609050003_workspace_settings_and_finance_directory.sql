-- Older deployments created this table before the admin UI started ordering
-- its records by creation time.
alter table public.workspace_settings
  add column if not exists created_at timestamptz not null default now();

-- Finance can review agent and finance-officer registrations without gaining
-- the ability to approve or edit them. Approval remains an Admin workflow.
drop policy if exists "finance workspace read staff directory" on public.profiles;
create policy "finance workspace read staff directory"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or (
      public.has_role(array['finance', 'finance_officer', 'admin', 'super_admin']::public.app_role[])
      and role = any(array['agent', 'support_agent', 'finance', 'finance_officer', 'admin', 'super_admin']::public.app_role[])
    )
  );

notify pgrst, 'reload schema';
