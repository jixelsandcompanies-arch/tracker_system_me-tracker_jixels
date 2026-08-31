-- Jixels database hardening migration.
-- Run after schema.sql. This migration is additive and safe to apply once per project.

-- Data quality constraints used by GPS and finance workflows.
alter table public.customers add constraint customers_email_format check (email is null or email = lower(email) and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') not valid;
alter table public.trackers add constraint trackers_latitude_range check (latitude is null or latitude between -90 and 90) not valid;
alter table public.trackers add constraint trackers_longitude_range check (longitude is null or longitude between -180 and 180) not valid;
alter table public.payments add constraint payments_currency_format check (currency ~ '^[A-Z]{3}$') not valid;
alter table public.reports add constraint reports_period_order check (period_end is null or period_start is null or period_end >= period_start) not valid;

-- Query-path indexes: dashboard counters, directory pagination, activity feeds, and heartbeat lookups.
create index if not exists customers_created_at_idx on public.customers (created_at desc);
create index if not exists customers_status_idx on public.customers (status, created_at desc);
create unique index if not exists customers_email_unique_idx on public.customers (lower(email)) where email is not null;
create index if not exists bikes_customer_idx on public.bikes (customer_id);
create index if not exists bikes_status_created_idx on public.bikes (status, created_at desc);
create index if not exists trackers_bike_idx on public.trackers (bike_id);
create index if not exists trackers_online_seen_idx on public.trackers (is_online, last_seen_at desc);
create index if not exists payments_customer_paid_idx on public.payments (customer_id, paid_at desc);
create index if not exists payments_status_created_idx on public.payments (status, created_at desc);
create index if not exists alerts_open_created_idx on public.alerts (created_at desc) where resolved_at is null;
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_created_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists chat_messages_created_idx on public.chat_messages (created_at asc);

-- Append-only telemetry keeps a trace of device data independently from current tracker state.
create table if not exists public.tracker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trackers(id) on delete cascade,
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  battery_percent integer check (battery_percent between 0 and 100),
  received_at timestamptz not null default now()
);
create index if not exists tracker_heartbeats_tracker_received_idx on public.tracker_heartbeats (tracker_id, received_at desc);
alter table public.tracker_heartbeats enable row level security;
drop policy if exists "staff view tracker heartbeats" on public.tracker_heartbeats;
create policy "staff view tracker heartbeats" on public.tracker_heartbeats for select to authenticated using (public.current_role() is not null);
revoke all on public.tracker_heartbeats from anon;

-- Ensure audit records stay immutable even when a privileged database role is used.
create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Audit logs are append-only';
end; $$;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function public.prevent_audit_mutation();

-- A validated, atomic heartbeat update. Only the Edge Function service role can execute it.
create or replace function public.record_tracker_heartbeat(
  tracker_identifier text, tracker_latitude numeric, tracker_longitude numeric, tracker_battery integer default null
) returns public.trackers language plpgsql security definer set search_path = public as $$
declare updated_tracker public.trackers;
begin
  if tracker_latitude not between -90 and 90 or tracker_longitude not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
  if tracker_battery is not null and tracker_battery not between 0 and 100 then raise exception 'Invalid battery percentage'; end if;
  update public.trackers set last_seen_at = now(), is_online = true, latitude = tracker_latitude, longitude = tracker_longitude
    where identifier = tracker_identifier returning * into updated_tracker;
  if updated_tracker.id is null then raise exception 'Unknown tracker'; end if;
  insert into public.tracker_heartbeats (tracker_id, latitude, longitude, battery_percent) values (updated_tracker.id, tracker_latitude, tracker_longitude, tracker_battery);
  if tracker_battery is not null and updated_tracker.bike_id is not null then update public.bikes set battery_percent = tracker_battery where id = updated_tracker.bike_id; end if;
  return updated_tracker;
end; $$;
revoke all on function public.record_tracker_heartbeat(text, numeric, numeric, integer) from public, anon, authenticated;

-- Call every few minutes from Supabase Cron to show stale trackers accurately.
create or replace function public.mark_stale_trackers(stale_after interval default interval '10 minutes')
returns integer language plpgsql security definer set search_path = public as $$
declare changed_count integer;
begin
  update public.trackers set is_online = false where is_online and (last_seen_at is null or last_seen_at < now() - stale_after);
  get diagnostics changed_count = row_count;
  return changed_count;
end; $$;
revoke all on function public.mark_stale_trackers(interval) from public, anon, authenticated;
