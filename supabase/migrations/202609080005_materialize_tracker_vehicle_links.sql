-- Materialize the customer-app vehicle row for legacy Operations records when
-- the owner can be matched by the shared customer email. This repairs older
-- accounts where the admin bike/tracker existed but no private vehicle row
-- had been created yet.
insert into public.vehicles (owner_id, registration, model, vehicle_type, tracker_imei)
select p.id,
       b.identifier,
       coalesce(b.model, 'Unspecified'),
       case when lower(coalesce(b.product_type, '')) in ('car', 'tuk_tuk') then lower(b.product_type) else 'motorcycle' end,
       coalesce(t.tramigo_device_id, t.identifier)
from public.trackers t
join public.bikes b on b.id = t.bike_id
join public.customers c on c.id = b.customer_id
join public.profiles p on lower(p.email) = lower(c.email)
where t.vehicle_id is null
  and c.email is not null
  and not exists (
    select 1 from public.vehicles v
    where v.owner_id = p.id and (v.registration = b.identifier or v.tracker_imei = coalesce(t.tramigo_device_id, t.identifier))
  )
on conflict (owner_id, registration) do update
  set tracker_imei = coalesce(public.vehicles.tracker_imei, excluded.tracker_imei);

update public.trackers as t
set vehicle_id = v.id,
    updated_at = now()
from public.bikes b
join public.customers c on c.id = b.customer_id
join public.profiles p on lower(p.email) = lower(c.email)
join public.vehicles v on v.owner_id = p.id
where t.vehicle_id is null
  and t.bike_id = b.id
  and (v.registration = b.identifier or v.tracker_imei = coalesce(t.tramigo_device_id, t.identifier));

notify pgrst, 'reload schema';
