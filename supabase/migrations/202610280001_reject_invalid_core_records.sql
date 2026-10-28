-- Reject empty or invalid core records even when clients bypass the admin forms.
-- NOT VALID leaves historical rows readable while enforcing future inserts and updates.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_full_name_nonblank' and conrelid = 'public.customers'::regclass) then
    alter table public.customers
      add constraint customers_full_name_nonblank
      check (btrim(full_name) <> '') not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'bikes_inventory_values_valid' and conrelid = 'public.bikes'::regclass) then
    alter table public.bikes
      add constraint bikes_inventory_values_valid
      check (
        btrim(identifier) <> ''
        and product_type in ('bike', 'car', 'tuktuk', 'device', 'other')
        and payable_amount > 0
        and (product_type <> 'other' or nullif(btrim(custom_product_type), '') is not null)
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'trackers_identifier_nonblank' and conrelid = 'public.trackers'::regclass) then
    alter table public.trackers
      add constraint trackers_identifier_nonblank
      check (btrim(identifier) <> '') not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payments_amount_positive' and conrelid = 'public.payments'::regclass) then
    alter table public.payments
      add constraint payments_amount_positive
      check (amount > 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'support_cases_title_nonblank' and conrelid = 'public.support_cases'::regclass) then
    alter table public.support_cases
      add constraint support_cases_title_nonblank
      check (btrim(title) <> '') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wifi_packages_values_valid' and conrelid = 'public.wifi_packages'::regclass) then
    alter table public.wifi_packages
      add constraint wifi_packages_values_valid
      check (
        btrim(name) <> ''
        and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        and price_kes > 0
        and duration_minutes > 0
      ) not valid;
  end if;

end $$;
