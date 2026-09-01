alter table public.bikes drop constraint if exists bikes_product_type_check;
update public.bikes set product_type = 'tuktuk' where product_type = 'asset';
alter table public.bikes
  add constraint bikes_product_type_check
  check (product_type in ('bike', 'car', 'tuktuk', 'device', 'other'));
