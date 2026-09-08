-- Finance settings is a singleton record but the shared portal data loader
-- consistently orders every table by created_at. Add the missing timestamp
-- without changing existing settings or their updated_at value.
alter table public.finance_settings
  add column if not exists created_at timestamptz not null default now();

update public.finance_settings
set created_at = updated_at
where created_at is null;

notify pgrst, 'reload schema';
