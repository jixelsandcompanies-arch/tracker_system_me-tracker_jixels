alter table public.trackers
  add column if not exists operational_status text not null default 'offline';

alter table public.trackers
  drop constraint if exists trackers_operational_status_check;

alter table public.trackers
  add constraint trackers_operational_status_check
  check (operational_status in ('online', 'offline', 'immobilized'));

update public.trackers
set operational_status = case when is_online then 'online' else 'offline' end
where operational_status is null or operational_status not in ('online', 'offline', 'immobilized');
