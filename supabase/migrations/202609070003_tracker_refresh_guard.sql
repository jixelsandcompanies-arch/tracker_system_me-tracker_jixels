-- A short, database-backed lease prevents concurrent Operations screens from
-- flooding Tramigo when users open or refresh the live fleet map together.
create table if not exists public.api_request_locks (
  lock_key text primary key,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.api_request_locks enable row level security;
revoke all on public.api_request_locks from anon, authenticated;

create or replace function public.claim_tracker_refresh(p_lock_key text, p_seconds integer default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed boolean;
begin
  if p_lock_key <> 'operations-tracker-refresh' then return false; end if;
  insert into public.api_request_locks as current_lock (lock_key, locked_until, updated_at)
  values (p_lock_key, now() + make_interval(secs => least(greatest(p_seconds, 5), 60)), now())
  on conflict (lock_key) do update
     set locked_until = excluded.locked_until, updated_at = excluded.updated_at
   where current_lock.locked_until <= now()
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_tracker_refresh(text, integer) from public;
grant execute on function public.claim_tracker_refresh(text, integer) to service_role;

notify pgrst, 'reload schema';
