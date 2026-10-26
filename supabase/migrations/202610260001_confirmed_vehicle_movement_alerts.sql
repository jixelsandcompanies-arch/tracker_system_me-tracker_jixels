-- Generate a durable in-app message when fresh tracker reports confirm a
-- vehicle started moving while customer monitoring is armed.
create table if not exists public.tracker_motion_state (
  source_id uuid primary key,
  is_moving boolean not null default false,
  last_recorded_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.tracker_motion_state enable row level security;
revoke all on public.tracker_motion_state from public, anon, authenticated;
grant all on public.tracker_motion_state to service_role;

alter table public.alerts add column if not exists push_sent_at timestamptz;

create or replace function public.record_confirmed_tracker_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tracked public.trackers%rowtype;
  assigned_bike public.bikes%rowtype;
  legacy_vehicle public.vehicles%rowtype;
  customer_email text;
  customer_owner uuid;
  vehicle_owner uuid;
  is_armed boolean := false;
  registration text;
  previous_point record;
  moved boolean := false;
  state_moving boolean;
  state_change boolean := false;
  movement_distance_m double precision;
  motion_source_id uuid;
begin
  -- Historical route imports and delayed device packets must not create a
  -- present-tense theft/movement alert.
  if new.recorded_at is null or new.recorded_at < now() - interval '2 minutes'
     or new.recorded_at > now() + interval '2 minutes' then
    return new;
  end if;

  if new.tracker_id is not null then
    select * into tracked from public.trackers where id = new.tracker_id;
    if tracked.id is null then return new; end if;
    if tracked.bike_id is not null then
      select * into assigned_bike from public.bikes where id = tracked.bike_id;
      is_armed := coalesce(assigned_bike.monitoring_armed, false);
      registration := coalesce(assigned_bike.identifier, 'Vehicle');
      select c.email into customer_email from public.customers c where c.id = assigned_bike.customer_id;
      if customer_email is not null then
        select p.id into customer_owner from public.profiles p where lower(p.email) = lower(customer_email) limit 1;
      end if;
    elsif tracked.vehicle_id is not null then
      select * into legacy_vehicle from public.vehicles where id = tracked.vehicle_id;
      is_armed := coalesce(legacy_vehicle.monitoring_armed, false);
      registration := coalesce(legacy_vehicle.registration, 'Vehicle');
      vehicle_owner := legacy_vehicle.owner_id;
    end if;
  elsif new.vehicle_id is not null then
    select * into legacy_vehicle from public.vehicles where id = new.vehicle_id;
    is_armed := coalesce(legacy_vehicle.monitoring_armed, false);
    registration := coalesce(legacy_vehicle.registration, 'Vehicle');
    vehicle_owner := legacy_vehicle.owner_id;
  end if;

  customer_owner := coalesce(customer_owner, vehicle_owner);
  if customer_owner is null then return new; end if;

  if new.speed_kph is not null and new.speed_kph >= 3 then
    moved := true;
  else
    if new.tracker_id is not null then
      select latitude, longitude into previous_point
        from public.tracker_locations
       where tracker_id = new.tracker_id and id <> new.id
         and recorded_at < new.recorded_at and recorded_at >= new.recorded_at - interval '15 minutes'
       order by recorded_at desc limit 1;
    else
      select latitude, longitude into previous_point
        from public.tracker_locations
       where vehicle_id = new.vehicle_id and id <> new.id
         and recorded_at < new.recorded_at and recorded_at >= new.recorded_at - interval '15 minutes'
       order by recorded_at desc limit 1;
    end if;
    if found then
      movement_distance_m := 6371000 * 2 * asin(sqrt(
        power(sin(radians((new.latitude - previous_point.latitude) / 2)), 2)
        + cos(radians(previous_point.latitude)) * cos(radians(new.latitude))
        * power(sin(radians((new.longitude - previous_point.longitude) / 2)), 2)
      ));
      moved := movement_distance_m >= 50;
    end if;
  end if;

  -- Disarmed reports reset the transition state. Re-arming during a later
  -- trip can therefore still produce a new movement notification.
  state_moving := is_armed and moved;
  motion_source_id := coalesce(new.tracker_id, new.vehicle_id);
  if motion_source_id is null then return new; end if;
  insert into public.tracker_motion_state (source_id, is_moving, last_recorded_at, updated_at)
  values (motion_source_id, state_moving, new.recorded_at, now())
  on conflict (source_id) do update
    set is_moving = excluded.is_moving,
        last_recorded_at = excluded.last_recorded_at,
        updated_at = now()
    where public.tracker_motion_state.is_moving is distinct from excluded.is_moving
  returning true into state_change;

  if state_change and state_moving then
    insert into public.alerts (owner_id, vehicle_id, title, body, detail, kind, severity, created_at)
    values (
      customer_owner,
      legacy_vehicle.id,
      'Vehicle movement confirmed',
      registration || ' has started moving while monitoring is armed.',
      registration || ' movement was confirmed by a fresh tracker speed or GPS position report.',
      'movement',
      'warning',
      now()
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_confirmed_tracker_movement() from public, anon, authenticated;
grant execute on function public.record_confirmed_tracker_movement() to service_role;

drop trigger if exists tracker_location_confirmed_movement on public.tracker_locations;
create trigger tracker_location_confirmed_movement
after insert on public.tracker_locations
for each row execute function public.record_confirmed_tracker_movement();

notify pgrst, 'reload schema';
