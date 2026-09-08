-- A number of legacy customer records were created before email was required.
-- Match those records to the authenticated profile by normalized full name,
-- then materialize/link the private vehicle used by route history.
insert into public.vehicles (owner_id, registration, model, vehicle_type, tracker_imei)
select p.id,
       b.identifier,
       coalesce(b.model, 'Unspecified'),
       case when lower(coalesce(b.product_type, '')) in ('car', 'tuk_tuk') then lower(b.product_type) else 'motorcycle' end,
       case when not exists (select 1 from public.vehicles existing where existing.tracker_imei = coalesce(t.tramigo_device_id, t.identifier)) then coalesce(t.tramigo_device_id, t.identifier) else null end
from public.trackers t
join public.bikes b on b.id = t.bike_id
join public.customers c on c.id = b.customer_id
join public.profiles p on lower(trim(p.full_name)) = lower(trim(c.full_name))
where t.vehicle_id is null
  and c.full_name is not null
  and not exists (select 1 from public.vehicles v where v.owner_id = p.id and v.registration = b.identifier)
on conflict (owner_id, registration) do nothing;

update public.trackers as t
set vehicle_id = v.id,
    updated_at = now()
from public.bikes b
join public.customers c on c.id = b.customer_id
join public.profiles p on lower(trim(p.full_name)) = lower(trim(c.full_name))
join public.vehicles v on v.owner_id = p.id and v.registration = b.identifier
where t.vehicle_id is null
  and t.bike_id = b.id;

notify pgrst, 'reload schema';
