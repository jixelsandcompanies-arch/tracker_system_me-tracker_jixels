-- Before inventory deletion was routed through the Admin API, deleting a bike
-- left its tracker row unlinked. Unlinked trackers cannot be assigned, sold, or
-- monitored, so remove them.

delete from public.trackers tracker
where tracker.bike_id is null
   or not exists (select 1 from public.bikes bike where bike.id = tracker.bike_id);

notify pgrst, 'reload schema';
