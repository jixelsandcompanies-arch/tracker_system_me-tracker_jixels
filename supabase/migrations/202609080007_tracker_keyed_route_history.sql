-- Operations history must remain available even when an older customer
-- vehicle record was never materialized. Keep the tracker identity alongside
-- the owner-scoped vehicle identity; customers still read only by vehicle.
alter table public.tracker_locations
  alter column vehicle_id drop not null,
  add column if not exists tracker_id uuid references public.trackers(id) on delete set null;

create index if not exists tracker_locations_tracker_recorded_idx
  on public.tracker_locations(tracker_id, recorded_at desc);

notify pgrst, 'reload schema';
