alter table public.screening_applications
  add column if not exists national_id text,
  add column if not exists address_town text,
  add column if not exists registration_number text,
  add column if not exists vehicle_make text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_type text,
  add column if not exists chassis_vin text,
  add column if not exists tracker_identifier text,
  add column if not exists tracker_serial_number text,
  add column if not exists tracker_model text,
  add column if not exists installation_date date,
  add column if not exists installer_agent_id uuid references public.profiles(id) on delete set null,
  add column if not exists installation_status text not null default 'pending',
  add column if not exists service_plan text,
  add column if not exists activation_date date,
  add column if not exists renewal_date date;

alter table public.screening_applications drop constraint if exists screening_installation_status_check;
alter table public.screening_applications add constraint screening_installation_status_check check (installation_status in ('pending', 'scheduled', 'installed', 'failed'));
