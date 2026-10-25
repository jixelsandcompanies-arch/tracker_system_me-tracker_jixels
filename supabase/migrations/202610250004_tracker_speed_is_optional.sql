-- Tracker heartbeats can refresh online status without containing a speed
-- measurement. Keep that value unknown instead of treating it as stationary.
alter table public.tracker_locations
  alter column speed_kph drop not null,
  alter column speed_kph drop default;
