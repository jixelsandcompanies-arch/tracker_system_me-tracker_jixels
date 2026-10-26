-- Allow device heartbeats to provide speed so motion can be confirmed even
-- when Tramigo Cloud is temporarily unavailable.
drop function if exists public.record_tracker_heartbeat(text, double precision, double precision, integer, timestamptz);

create or replace function public.record_tracker_heartbeat(
  tracker_identifier text,
  tracker_latitude double precision default null,
  tracker_longitude double precision default null,
  tracker_battery integer default null,
  tracker_speed_kph double precision default null,
  tracker_recorded_at timestamptz default null
) returns public.trackers
language plpgsql security definer set search_path = public as $$
declare
  updated_tracker public.trackers%rowtype;
  received_time timestamptz := now();
begin
  if nullif(btrim(tracker_identifier), '') is null then raise exception 'Tracker identifier is required'; end if;
  if (tracker_latitude is null) <> (tracker_longitude is null) then raise exception 'Latitude and longitude must be provided together'; end if;
  if tracker_latitude is not null and (tracker_latitude not between -90 and 90 or tracker_longitude not between -180 and 180) then raise exception 'Invalid coordinates'; end if;
  if tracker_battery is not null and tracker_battery not between 0 and 100 then raise exception 'Invalid battery percentage'; end if;
  if tracker_speed_kph is not null and tracker_speed_kph not between 0 and 300 then raise exception 'Invalid tracker speed'; end if;

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
      where identifier = btrim(tracker_identifier) or tramigo_device_id = btrim(tracker_identifier)
      order by (identifier = btrim(tracker_identifier)) desc limit 1
   )
   returning * into updated_tracker;

  if updated_tracker.id is null then raise exception 'Unknown tracker'; end if;

  insert into public.tracker_heartbeats
    (tracker_id, latitude, longitude, battery_percent, tracker_status, recorded_at, received_at)
  values (updated_tracker.id, tracker_latitude, tracker_longitude, tracker_battery, 'online', tracker_recorded_at, received_time);

  if tracker_latitude is not null and (updated_tracker.vehicle_id is not null or updated_tracker.bike_id is not null) then
    insert into public.tracker_locations (vehicle_id, tracker_id, latitude, longitude, speed_kph, recorded_at)
    values (updated_tracker.vehicle_id, updated_tracker.id, tracker_latitude, tracker_longitude, tracker_speed_kph,
            coalesce(tracker_recorded_at, received_time));
  end if;

  return updated_tracker;
end;
$$;

revoke all on function public.record_tracker_heartbeat(text, double precision, double precision, integer, double precision, timestamptz) from public, anon, authenticated;
grant execute on function public.record_tracker_heartbeat(text, double precision, double precision, integer, double precision, timestamptz) to service_role;

notify pgrst, 'reload schema';
