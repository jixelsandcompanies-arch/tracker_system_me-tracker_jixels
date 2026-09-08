-- Some older Operations records identify the product through bike_id rather
-- than the customer's tracker IMEI. Link those records to the corresponding
-- private vehicle so route history is available in both workspaces.
update public.trackers as t
set vehicle_id = v.id,
    updated_at = now()
from public.bikes as b
join public.vehicles as v on v.registration = b.identifier
where t.vehicle_id is null
  and t.bike_id = b.id;

notify pgrst, 'reload schema';
