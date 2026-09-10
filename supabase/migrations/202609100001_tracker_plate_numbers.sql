begin;

alter table public.trackers add column if not exists plate_number text;
alter table public.customers add column if not exists plate_number text;

-- Use known vehicle registrations; do not mistake arbitrary product labels
-- or tracker identifiers for vehicle plates.
update public.trackers t set plate_number = upper(trim(v.registration))
from public.vehicles v
where t.vehicle_id = v.id and nullif(trim(t.plate_number), '') is null;

create or replace function public.refresh_customer_plates(p_customer_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.customers c
  set plate_number = (
    select string_agg(distinct upper(trim(t.plate_number)), ', ' order by upper(trim(t.plate_number)))
    from public.bikes b join public.trackers t on t.bike_id = b.id
    where b.customer_id = p_customer_id and nullif(trim(t.plate_number), '') is not null
  ), updated_at = now()
  where c.id = p_customer_id;
$$;
revoke all on function public.refresh_customer_plates(uuid) from public, anon, authenticated;

create or replace function public.sync_tracker_customer_plates()
returns trigger language plpgsql security definer set search_path = public as $$
declare previous_customer uuid; next_customer uuid;
begin
  if tg_op <> 'INSERT' then
    select customer_id into previous_customer from public.bikes where id = old.bike_id;
    perform public.refresh_customer_plates(previous_customer);
  end if;
  if tg_op <> 'DELETE' then
    select customer_id into next_customer from public.bikes where id = new.bike_id;
    perform public.refresh_customer_plates(next_customer);
  end if;
  return null;
end;
$$;
create trigger tracker_customer_plates after insert or update of plate_number, bike_id or delete
on public.trackers for each row execute function public.sync_tracker_customer_plates();

create or replace function public.sync_bike_customer_plates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.customer_id is distinct from new.customer_id then
    perform public.refresh_customer_plates(old.customer_id);
    perform public.refresh_customer_plates(new.customer_id);
  end if;
  return null;
end;
$$;
create trigger bike_customer_plates after update of customer_id on public.bikes
for each row execute function public.sync_bike_customer_plates();

select public.refresh_customer_plates(b.customer_id) from public.bikes b
where b.customer_id is not null
and exists (select 1 from public.trackers t where t.bike_id = b.id and t.plate_number is not null)
group by b.customer_id;

notify pgrst, 'reload schema';
commit;
