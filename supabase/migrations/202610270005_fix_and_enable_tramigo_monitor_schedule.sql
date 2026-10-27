-- Correct and enable the server-side monitor scheduler. The earlier function
-- used PERFORM ... INTO, which PostgreSQL rejects when the scheduler is run.
create or replace function public.schedule_tramigo_monitor()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  monitor_url text;
  monitor_service_key text;
  existing_job_id bigint;
  scheduled_job_id bigint;
begin
  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null or to_regclass('net.http_request_queue') is null then
    raise exception 'Enable pg_cron, pg_net, and Vault before scheduling Tramigo monitoring';
  end if;

  select decrypted_secret into monitor_url
    from vault.decrypted_secrets where name = 'tramigo-monitor-url' limit 1;
  select decrypted_secret into monitor_service_key
    from vault.decrypted_secrets where name = 'tramigo-monitor-service-role-key' limit 1;
  if nullif(monitor_url, '') is null or nullif(monitor_service_key, '') is null then
    raise exception 'Create the tramigo-monitor-url and tramigo-monitor-service-role-key Vault secrets first';
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'tramigo-monitor' limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;

  select cron.schedule(
    'tramigo-monitor',
    '* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'tramigo-monitor-url' limit 1),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tramigo-monitor-service-role-key' limit 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  ) into scheduled_job_id;

  return scheduled_job_id;
end;
$$;

revoke all on function public.schedule_tramigo_monitor() from public, anon, authenticated;
select public.schedule_tramigo_monitor();
