-- Exact GPS positions and tracker identifiers are never browser-readable.
-- The API verifies the authenticated owner before using its service role.

alter table public.vehicles enable row level security;
alter table public.tracker_locations enable row level security;

drop policy if exists "users manage their vehicles" on public.vehicles;
drop policy if exists "users read their vehicle locations" on public.tracker_locations;

revoke all privileges on table public.vehicles from anon, authenticated;
revoke all privileges on table public.tracker_locations from anon, authenticated;

-- Remove GPS history from Supabase Realtime. Live customer tracking uses the
-- authenticated API, not a browser subscription to the underlying table.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracker_locations'
  ) then
    alter publication supabase_realtime drop table public.tracker_locations;
  end if;
end $$;

-- Prevent support and read-only roles from reading the Operations tracker
-- table, which contains current latitude and longitude.
drop policy if exists "workspace staff read trackers" on public.trackers;
drop policy if exists "location-authorized read trackers" on public.trackers;
create policy "location-authorized read trackers" on public.trackers for select to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager']::public.app_role[]));

-- Bound upstream Tramigo reads per signed-in customer and vehicle. The API
-- falls back to the most recent server-stored position during the window.
create table if not exists public.location_provider_rate_limits (
  request_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.location_provider_rate_limits enable row level security;
revoke all privileges on table public.location_provider_rate_limits from anon, authenticated;

create or replace function public.claim_location_provider_read(
  p_key text,
  p_max_requests integer default 4,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed boolean;
begin
  if length(p_key) > 200 or p_max_requests not between 1 and 20 or p_window_seconds not between 10 and 300 then
    return false;
  end if;
  insert into public.location_provider_rate_limits as limit_row (request_key, window_started_at, request_count, updated_at)
  values (p_key, now(), 1, now())
  on conflict (request_key) do update
    set window_started_at = case when limit_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then now() else limit_row.window_started_at end,
        request_count = case when limit_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1 else limit_row.request_count + 1 end,
        updated_at = now()
    where limit_row.window_started_at <= now() - make_interval(secs => p_window_seconds)
       or limit_row.request_count < p_max_requests
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_location_provider_read(text, integer, integer) from public;
grant execute on function public.claim_location_provider_read(text, integer, integer) to service_role;

notify pgrst, 'reload schema';
