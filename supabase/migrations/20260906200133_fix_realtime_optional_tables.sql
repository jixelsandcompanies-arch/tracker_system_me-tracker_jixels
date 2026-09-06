-- Safely enable Supabase Realtime for operational tables.
-- Missing optional tables are skipped instead of failing the migration.

do $$
declare
  table_name text;
begin

  foreach table_name in array array[
    'customers',
    'bikes',
    'trackers',
    'tracker_heartbeats',
    'payments',
    'screening_applications',
    'profiles',
    'finance_accounts',
    'finance_payments',
    'finance_alerts',
    'finance_settings',
    'alerts'
  ]
  loop

    if exists (
      select 1
      from pg_tables
      where schemaname = 'public'
        and tablename = table_name
    )
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    )
    then

      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );

    end if;

  end loop;

end;
$$;

notify pgrst, 'reload schema';