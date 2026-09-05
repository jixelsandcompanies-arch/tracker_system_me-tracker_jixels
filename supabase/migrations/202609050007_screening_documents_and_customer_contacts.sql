-- Persist the three identity documents captured by field agents. Documents live
-- in a private bucket and are exposed to authorized administrators by signed URL.
alter table public.screening_applications
  add column if not exists customer_photo_url text,
  add column if not exists id_front_url text,
  add column if not exists id_back_url text,
  add column if not exists payment_phone text,
  add column if not exists location text;

insert into storage.buckets (id, name, public)
values ('screening-documents', 'screening-documents', false)
on conflict (id) do update set public = false;

-- Older clients could create multiple pending applications for the same tracker
-- before the tracker reservation was checked atomically. Keep the first record.
with ranked as (
  select id, customer_id, product_id,
    row_number() over (partition by product_id order by (status = 'approved') desc, created_at asc, id asc) as row_number
  from public.screening_applications
  where product_id is not null and status in ('pending', 'approved')
), duplicate_applications as (
  delete from public.screening_applications application
  using ranked
  where application.id = ranked.id and ranked.row_number > 1
  returning application.customer_id
), orphaned_customers as (
  delete from public.customers customer
  where customer.id in (select customer_id from duplicate_applications where customer_id is not null)
    and not exists (select 1 from public.screening_applications application where application.customer_id = customer.id)
  returning customer.id
)
select count(*) from orphaned_customers;

with retained as (
  select distinct on (product_id) product_id, customer_id
  from public.screening_applications
  where product_id is not null and status in ('pending', 'approved')
  order by product_id, (status = 'approved') desc, created_at asc, id asc
)
update public.bikes bike
set customer_id = retained.customer_id,
    status = 'pending',
    updated_at = now()
from retained
where bike.id = retained.product_id and bike.customer_id is null;

create unique index if not exists screening_one_open_application_per_product
  on public.screening_applications (product_id)
  where product_id is not null and status in ('pending', 'approved');

notify pgrst, 'reload schema';
