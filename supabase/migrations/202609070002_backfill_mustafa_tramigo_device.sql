-- The Operations record was renamed to the provider device ID after the
-- initial mapping. Keep both historical and current identifiers covered.
update public.trackers
   set tramigo_device_id = '861192078436709', updated_at = now()
 where identifier in ('861192078447102', '861192078436709')
   and (tramigo_device_id is null or tramigo_device_id <> '861192078436709');

notify pgrst, 'reload schema';
