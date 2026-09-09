-- Align the live catalogue with the approved customer pricing.
alter table public.wifi_packages
  add column if not exists is_best_value boolean not null default false;

update public.wifi_packages
set name = 'Weekly', price_kes = 300, duration_minutes = 10080,
    description = 'Unlimited Wi-Fi for 7 days', is_best_value = false,
    updated_at = now()
where slug = 'weekly';

update public.wifi_packages
set name = 'Monthly', price_kes = 800, duration_minutes = 43200,
    description = 'Unlimited Wi-Fi for 30 days', is_best_value = true,
    updated_at = now()
where slug = 'monthly';

update public.wifi_packages
set is_best_value = false
where slug not in ('monthly');

notify pgrst, 'reload schema';
