-- Links Operations tracker records to their actual Tramigo Cloud device IDs.
-- Internal tracker labels (for example T-003GHBS) must never be used for a
-- Tramigo API request unless they are also the provider's device ID.
alter table public.trackers add column if not exists tramigo_device_id text;

create unique index if not exists trackers_tramigo_device_id_unique
  on public.trackers (tramigo_device_id)
  where tramigo_device_id is not null;

-- Confirmed by Operations: Mustafa Foray's active Tramigo device.
update public.trackers
   set tramigo_device_id = '861192078436709', updated_at = now()
 where identifier = '861192078447102';

notify pgrst, 'reload schema';
