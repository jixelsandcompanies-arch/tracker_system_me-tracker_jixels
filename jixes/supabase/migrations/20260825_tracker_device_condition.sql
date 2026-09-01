alter table public.trackers
  add column if not exists device_condition text not null default 'normal';

alter table public.trackers
  drop constraint if exists trackers_device_condition_check;

alter table public.trackers
  add constraint trackers_device_condition_check
  check (device_condition in ('normal', 'damaged', 'destroyed', 'tampered'));
