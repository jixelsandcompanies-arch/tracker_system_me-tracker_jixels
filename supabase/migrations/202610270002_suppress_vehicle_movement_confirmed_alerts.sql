-- Stop creating customer alerts for confirmed vehicle movement. This does not
-- change tracker ingestion, live locations, or other alert types.
drop trigger if exists tracker_location_confirmed_movement on public.tracker_locations;
