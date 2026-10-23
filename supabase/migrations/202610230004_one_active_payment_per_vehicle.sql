-- Serialize concurrent prompt requests for the same active payment target.
with ranked as (
  select id, row_number() over (
    partition by owner_id, coalesce(bike_id::text, vehicle_id::text)
    order by created_at desc, id desc
  ) as attempt_order
  from public.payment_requests
  where status in ('pending', 'processing')
)
update public.payment_requests request
set status = 'cancelled', updated_at = now()
from ranked
where request.id = ranked.id and ranked.attempt_order > 1;

with ranked as (
  select id, row_number() over (
    partition by customer_id, product_id
    order by created_at desc, id desc
  ) as attempt_order
  from public.payments
  where payment_type = 'deposit' and status = 'processing'
)
update public.payments payment
set status = 'failed'
from ranked
where payment.id = ranked.id and ranked.attempt_order > 1;

create unique index if not exists payment_requests_one_active_bike_idx
  on public.payment_requests (owner_id, bike_id)
  where bike_id is not null and status in ('pending', 'processing');

create unique index if not exists payment_requests_one_active_vehicle_idx
  on public.payment_requests (owner_id, vehicle_id)
  where vehicle_id is not null and status in ('pending', 'processing');

create unique index if not exists payments_one_active_deposit_vehicle_idx
  on public.payments (customer_id, product_id)
  where payment_type = 'deposit' and status = 'processing';

notify pgrst, 'reload schema';
