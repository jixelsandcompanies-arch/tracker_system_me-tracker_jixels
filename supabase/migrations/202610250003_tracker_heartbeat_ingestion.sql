-- Persist tracker health pings for the customer/agent Supabase project.
-- A heartbeat may contain health data without a GPS fix; coordinates are optional,
-- and health pings never create a fake stationary route point.
create table if not exists public.tracker_heartbeats (
  id bigint generated always as identity primary key,
  tracker_id uuid not null references public.trackers(id) on delete cascade,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  battery_percent integer check (battery_percent is null or battery_percent between 0 and 100),
  tracker_status text not null default 'online' check (tracker_status in ('online', 'offline', 'unknown')),
  recorded_at timestamptz,
  received_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);

-- Upgrade the earlier Admin heartbeat table too, if it was already created in
-- this shared Supabase project with mandatory GPS coordinates.
alter table public.tracker_heartbeats add column if not exists tracker_status text not null default 'online';
alter table public.tracker_heartbeats add column if not exists recorded_at timestamptz;
alter table public.tracker_heartbeats alter column latitude drop not null;
alter table public.tracker_heartbeats alter column longitude drop not null;

create index if not exists tracker_heartbeats_tracker_received_idx
  on public.tracker_heartbeats (tracker_id, received_at desc);

alter table public.trackers add column if not exists battery_percent integer
  check (battery_percent is null or battery_percent between 0 and 100);
alter table public.tracker_heartbeats enable row level security;
drop policy if exists "staff read tracker heartbeats" on public.tracker_heartbeats;
create policy "staff read tracker heartbeats" on public.tracker_heartbeats
  for select to authenticated
  using (public.has_role(array['admin','super_admin','operations_manager','support_agent','finance','finance_officer','read_only_auditor']::public.app_role[]));
revoke all on public.tracker_heartbeats from anon, authenticated;
grant select on public.tracker_heartbeats to authenticated;
grant all on public.tracker_heartbeats to service_role;
do $$
declare heartbeat_sequence text;
begin
  heartbeat_sequence := pg_get_serial_sequence('public.tracker_heartbeats', 'id');
  if heartbeat_sequence is not null then
    execute format('grant usage, select on sequence %s to service_role', heartbeat_sequence);
  end if;
end;
$$;

create or replace function public.record_tracker_heartbeat(
  tracker_identifier text,
  tracker_latitude double precision default null,
  tracker_longitude double precision default null,
  tracker_battery integer default null,
  tracker_recorded_at timestamptz default null
) returns public.trackers
language plpgsql security definer set search_path = public as $$
declare
  updated_tracker public.trackers;
  received_time timestamptz := now();
begin
  if nullif(btrim(tracker_identifier), '') is null then
    raise exception 'Tracker identifier is required';
  end if;
  if (tracker_latitude is null) <> (tracker_longitude is null) then
    raise exception 'Latitude and longitude must be provided together';
  end if;
  if tracker_latitude is not null and (tracker_latitude not between -90 and 90 or tracker_longitude not between -180 and 180) then
    raise exception 'Invalid coordinates';
  end if;
  if tracker_battery is not null and tracker_battery not between 0 and 100 then
    raise exception 'Invalid battery percentage';
  end if;

  update public.trackers
     set last_seen_at = received_time,
         is_online = true,
         operational_status = 'online',
         latitude = coalesce(tracker_latitude, latitude),
         longitude = coalesce(tracker_longitude, longitude),
         battery_percent = coalesce(tracker_battery, battery_percent),
         updated_at = received_time
   where id = (
     select id from public.trackers
      where identifier = btrim(tracker_identifier)
         or tramigo_device_id = btrim(tracker_identifier)
      order by (identifier = btrim(tracker_identifier)) desc
      limit 1
   )
   returning * into updated_tracker;

  if updated_tracker.id is null then
    raise exception 'Unknown tracker';
  end if;

  insert into public.tracker_heartbeats
    (tracker_id, latitude, longitude, battery_percent, tracker_status, recorded_at, received_at)
  values
    (updated_tracker.id, tracker_latitude, tracker_longitude, tracker_battery, 'online', tracker_recorded_at, received_time);

  -- Only a real GPS fix enters route history; a health ping alone is not movement.
  if tracker_latitude is not null and updated_tracker.vehicle_id is not null then
    insert into public.tracker_locations (vehicle_id, tracker_id, latitude, longitude, recorded_at)
    values (updated_tracker.vehicle_id, updated_tracker.id, tracker_latitude, tracker_longitude,
            coalesce(tracker_recorded_at, received_time));
  end if;

  return updated_tracker;
end;
$$;

revoke all on function public.record_tracker_heartbeat(text, double precision, double precision, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.record_tracker_heartbeat(text, double precision, double precision, integer, timestamptz) to service_role;

create or replace function public.mark_stale_trackers(stale_after interval default interval '10 minutes')
returns integer language plpgsql security definer set search_path = public as $$
declare changed_count integer;
begin
  update public.trackers
     set is_online = false, operational_status = 'offline', updated_at = now()
   where is_online and (last_seen_at is null or last_seen_at < now() - stale_after);
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;
revoke all on function public.mark_stale_trackers(interval) from public, anon, authenticated;

-- Supabase projects with pg_cron enabled automatically mark silent devices offline.
-- If pg_cron is not enabled, the heartbeat ingest remains usable and this block is skipped.
do $$
declare existing_job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    execute 'select jobid from cron.job where jobname = $1 limit 1'
      into existing_job_id using 'tracker-heartbeat-stale-check';
    if existing_job_id is not null then
      execute 'select cron.unschedule($1)' using existing_job_id;
    end if;
    execute $schedule$
      select cron.schedule(
        'tracker-heartbeat-stale-check',
        '*/5 * * * *',
        'select public.mark_stale_trackers(interval ''10 minutes'')'
      )
    $schedule$;
  end if;
exception when undefined_function or insufficient_privilege then
  raise notice 'pg_cron could not schedule stale tracker checks; enable pg_cron and schedule public.mark_stale_trackers(interval ''10 minutes'') every 5 minutes.';
end;
$$;

notify pgrst, 'reload schema';
