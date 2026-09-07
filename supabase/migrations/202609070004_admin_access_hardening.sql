-- Limit browser-side database access by responsibility. The Edge Function
-- keeps its service-role authority; ordinary authenticated sessions do not.

alter table public.trackers
  add constraint trackers_tramigo_device_id_imei_format
  check (tramigo_device_id is null or tramigo_device_id ~ '^[0-9]{10,20}$') not valid;

-- Replace the former all-actions policy with least-privilege tracker access.
drop policy if exists "admin workspace access" on public.trackers;
create policy "workspace staff read trackers" on public.trackers for select to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager','support_agent','read_only_auditor']::public.app_role[]));
create policy "operations manage trackers" on public.trackers for all to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]))
  with check (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]));

drop policy if exists "admin workspace access" on public.bikes;
create policy "workspace staff read bikes" on public.bikes for select to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager','support_agent','read_only_auditor']::public.app_role[]));
create policy "operations manage bikes" on public.bikes for all to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]))
  with check (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]));

drop policy if exists "admin workspace access" on public.workspace_settings;
create policy "administrators manage workspace settings" on public.workspace_settings for all to authenticated
  using (public.has_role(array['admin','super_admin']::public.app_role[]))
  with check (public.has_role(array['admin','super_admin']::public.app_role[]));

-- Audit history is append-only. A signed-in user may create only their own
-- event and cannot edit or remove any past record.
drop policy if exists "admin workspace access" on public.audit_logs;
create policy "authorized staff read audit logs" on public.audit_logs for select to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager','read_only_auditor']::public.app_role[]));
create policy "authorized staff append audit logs" on public.audit_logs for insert to authenticated
  with check (
    actor_id = auth.uid()
    and public.has_role(array['admin','super_admin','operations_manager','support_agent']::public.app_role[])
  );

-- Support agents can work support cases but cannot alter fleet configuration.
drop policy if exists "admin workspace access" on public.support_cases;
create policy "support staff read cases" on public.support_cases for select to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager','support_agent']::public.app_role[]));
create policy "support staff manage cases" on public.support_cases for all to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager','support_agent']::public.app_role[]))
  with check (public.has_role(array['admin','super_admin','operations_manager','support_agent']::public.app_role[]));

drop policy if exists "admin workspace access" on public.support_case_history;
create policy "support staff read case history" on public.support_case_history for select to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager','support_agent']::public.app_role[]));
create policy "support staff append case history" on public.support_case_history for insert to authenticated
  with check (
    actor_id = auth.uid()
    and public.has_role(array['admin','super_admin','operations_manager','support_agent']::public.app_role[])
  );

notify pgrst, 'reload schema';
