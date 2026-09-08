-- Connect the Operations tracker record to the private vehicle history used
-- by the customer app.  This lets authorized staff inspect the same route
-- points without exposing tracker locations to the browser tables.
alter table public.trackers
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

create index if not exists trackers_vehicle_id_idx on public.trackers(vehicle_id);

update public.trackers as t
set vehicle_id = v.id,
    updated_at = now()
from public.vehicles as v
where t.vehicle_id is null
  and v.tracker_imei is not null
  and (v.tracker_imei = t.tramigo_device_id or v.tracker_imei = t.identifier);

notify pgrst, 'reload schema';
