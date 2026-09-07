-- The Operations record was renamed to the provider device ID after the
-- initial mapping. Keep both historical and current identifiers covered.
-- The former code may still be retained as a historical Operations record.
-- Remove its provider assignment first because a Tramigo device can map to
-- one active Operations record only.
update public.trackers
   set tramigo_device_id = null, updated_at = now()
 where identifier = '861192078447102'
   and tramigo_device_id = '861192078436709';

update public.trackers
   set tramigo_device_id = '861192078436709', updated_at = now()
 where identifier = '861192078436709';

notify pgrst, 'reload schema';
