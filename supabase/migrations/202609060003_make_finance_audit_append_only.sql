-- Finance audit rows are append-only. The Finance portal can create an event,
-- but it cannot rewrite or erase the history after it has been stored.

drop policy if exists "finance staff write" on public.finance_audit_logs;
drop policy if exists "finance staff insert" on public.finance_audit_logs;

create policy "finance staff insert" on public.finance_audit_logs
  for insert
  with check (public.has_role(array['finance','finance_officer','admin','super_admin']::public.app_role[]));
