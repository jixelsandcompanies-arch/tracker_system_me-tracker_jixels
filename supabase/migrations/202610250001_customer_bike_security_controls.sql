-- Persist customer controls on the customer-owned bike records used by the
-- Admin and Agent portals. Legacy customer vehicles keep their existing fields.
alter table public.bikes
  add column if not exists monitoring_armed boolean not null default false,
  add column if not exists immobilized boolean not null default false;

notify pgrst, 'reload schema';
