-- Permit the live map to request a fresh Tramigo read every three seconds.
-- Keep the existing per-key lock so concurrent app and admin requests cannot
-- multiply provider traffic for the same vehicle.
create or replace function public.claim_location_provider_read(
  p_key text,
  p_max_requests integer default 4,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed boolean;
begin
  if length(p_key) > 200 or p_max_requests not between 1 and 20 or p_window_seconds not between 1 and 300 then
    return false;
  end if;
  insert into public.location_provider_rate_limits as limit_row (request_key, window_started_at, request_count, updated_at)
  values (p_key, now(), 1, now())
  on conflict (request_key) do update
    set window_started_at = case when limit_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then now() else limit_row.window_started_at end,
        request_count = case when limit_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1 else limit_row.request_count + 1 end,
        updated_at = now()
    where limit_row.window_started_at <= now() - make_interval(secs => p_window_seconds)
       or limit_row.request_count < p_max_requests
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_location_provider_read(text, integer, integer) from public;
grant execute on function public.claim_location_provider_read(text, integer, integer) to service_role;
