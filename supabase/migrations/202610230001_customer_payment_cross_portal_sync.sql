-- Allow the mobile customer app to start a payment against the canonical
-- customer/bike records used by Admin and Finance, while retaining support for
-- legacy owner-scoped vehicles.
alter table public.payment_requests
  alter column vehicle_id drop not null,
  add column if not exists bike_id uuid references public.bikes(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_requests_target_required'
      and conrelid = 'public.payment_requests'::regclass
  ) then
    alter table public.payment_requests
      add constraint payment_requests_target_required
      check (vehicle_id is not null or bike_id is not null);
  end if;
end $$;

create index if not exists payment_requests_bike_created_idx
  on public.payment_requests(bike_id, created_at desc)
  where bike_id is not null;

notify pgrst, 'reload schema';
