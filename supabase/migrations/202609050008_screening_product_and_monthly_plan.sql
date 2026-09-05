alter table public.screening_applications
  add column if not exists product_identifier text,
  add column if not exists product_type text,
  add column if not exists product_model text,
  add column if not exists monthly_service_amount numeric(12,2) not null default 700;

update public.screening_applications application
set product_identifier = coalesce(application.product_identifier, bike.identifier),
    product_type = coalesce(application.product_type, bike.product_type),
    product_model = coalesce(application.product_model, bike.model),
    tracker_identifier = coalesce(application.tracker_identifier, tracker.identifier)
from public.bikes bike
left join lateral (
  select identifier from public.trackers where bike_id = bike.id order by created_at asc limit 1
) tracker on true
where application.product_id = bike.id;

notify pgrst, 'reload schema';
