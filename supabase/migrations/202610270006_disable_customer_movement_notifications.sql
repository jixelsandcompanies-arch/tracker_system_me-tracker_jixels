-- GPS updates still feed live tracking and route history, but do not create
-- customer alerts or push notifications for routine vehicle movement.
drop trigger if exists tracker_location_confirmed_movement on public.tracker_locations;

notify pgrst, 'reload schema';
