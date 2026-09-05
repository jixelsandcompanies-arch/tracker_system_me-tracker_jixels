-- Shared, server-side login lockout state. Account identifiers are SHA-256
-- hashes supplied by the API so this table does not retain plain email values.
create table if not exists public.login_attempt_limits (
  account_key text primary key check (char_length(account_key) = 64),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_attempt_limits enable row level security;
revoke all on table public.login_attempt_limits from anon, authenticated;

create or replace function public.get_login_lock(p_account_key text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lock timestamptz;
begin
  select locked_until into current_lock
    from public.login_attempt_limits
   where account_key = p_account_key;

  if current_lock is not null and current_lock <= now() then
    update public.login_attempt_limits
       set failed_attempts = 0,
           locked_until = null,
           updated_at = now()
     where account_key = p_account_key;
    return null;
  end if;

  return current_lock;
end;
$$;

create or replace function public.record_login_failure(p_account_key text)
returns table(failed_attempts integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.login_attempt_limits as limits (account_key, failed_attempts, locked_until, updated_at)
  values (p_account_key, 1, null, now())
  on conflict (account_key) do update
     set failed_attempts = case
           when limits.locked_until is not null and limits.locked_until <= now() then 1
           else limits.failed_attempts + 1
         end,
         locked_until = case
           when case
             when limits.locked_until is not null and limits.locked_until <= now() then 1
             else limits.failed_attempts + 1
           end >= 4 then now() + interval '15 minutes'
           else null
         end,
         updated_at = now()
  returning limits.failed_attempts, limits.locked_until;
end;
$$;

create or replace function public.clear_login_failures(p_account_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_attempt_limits where account_key = p_account_key;
$$;

revoke all on function public.get_login_lock(text) from public;
revoke all on function public.record_login_failure(text) from public;
revoke all on function public.clear_login_failures(text) from public;
grant execute on function public.get_login_lock(text) to service_role;
grant execute on function public.record_login_failure(text) to service_role;
grant execute on function public.clear_login_failures(text) to service_role;

notify pgrst, 'reload schema';
