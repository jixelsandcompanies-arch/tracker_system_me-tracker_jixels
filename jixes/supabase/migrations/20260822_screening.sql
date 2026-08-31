-- Products and applicant screening. The legacy `bikes` table remains the product
-- store for backwards compatibility with existing tracker integrations.
alter table public.bikes add column if not exists product_type text not null default 'bike';
alter table public.bikes add column if not exists custom_product_type text;
alter table public.bikes drop constraint if exists bikes_product_type_check;
update public.bikes set custom_product_type = product_type, product_type = 'other'
where product_type not in ('bike', 'car', 'asset', 'device', 'other');
update public.bikes set custom_product_type = 'Other' where product_type = 'other' and char_length(trim(coalesce(custom_product_type, ''))) = 0;
alter table public.bikes add constraint bikes_product_type_check check (product_type in ('bike', 'car', 'asset', 'device', 'other'));
alter table public.bikes drop constraint if exists bikes_custom_product_type_check;
alter table public.bikes add constraint bikes_custom_product_type_check check ((product_type = 'other' and char_length(trim(coalesce(custom_product_type, ''))) > 0) or product_type <> 'other');

create table if not exists public.screening_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  customer_id uuid references public.customers(id) on delete set null,
  product_id uuid references public.bikes(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'reviewing', 'approved', 'declined')),
  notes text,
  documents jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.screening_applications add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.screening_applications add column if not exists product_id uuid references public.bikes(id) on delete set null;

drop trigger if exists screening_applications_updated_at on public.screening_applications;
create trigger screening_applications_updated_at before update on public.screening_applications
for each row execute function public.touch_updated_at();

alter table public.screening_applications enable row level security;
create policy "staff view screening" on public.screening_applications for select to authenticated
using (public.current_role() is not null);
create policy "staff create screening" on public.screening_applications for insert to authenticated
with check (public.current_role() in ('super_admin', 'operations_manager', 'support_agent'));
create policy "managers update screening" on public.screening_applications for update to authenticated
using (public.current_role() in ('super_admin', 'operations_manager'))
with check (public.current_role() in ('super_admin', 'operations_manager'));

create or replace function public.notify_new_screening_application()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.alerts (kind, title, detail, severity)
  values ('screening_application', 'New screening application', new.full_name, 'info');
  return new;
end; $$;

drop trigger if exists screening_application_created on public.screening_applications;
create trigger screening_application_created after insert on public.screening_applications
for each row execute function public.notify_new_screening_application();
