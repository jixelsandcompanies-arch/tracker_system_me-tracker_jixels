-- Restore movement alerts for vehicles customers explicitly arm.
-- A previous migration disabled this trigger; keep its historical migration
-- intact and re-enable the current alert rule with a forward migration.
drop trigger if exists tracker_location_confirmed_movement on public.tracker_locations;
create trigger tracker_location_confirmed_movement
after insert on public.tracker_locations
for each row execute function public.record_confirmed_tracker_movement();

notify pgrst, 'reload schema';
