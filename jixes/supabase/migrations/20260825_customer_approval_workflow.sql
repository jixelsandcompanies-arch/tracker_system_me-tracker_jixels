alter table public.screening_applications
  add column if not exists customer_photo_url text,
  add column if not exists id_front_url text,
  add column if not exists id_back_url text,
  add column if not exists passport_url text,
  add column if not exists deposit_amount numeric(12,2) not null default 0,
  add column if not exists approved_at timestamptz;

update public.screening_applications set status = 'pending' where status in ('new', 'reviewing');
update public.screening_applications set status = 'suspended' where status = 'declined';
alter table public.screening_applications drop constraint if exists screening_applications_status_check;
alter table public.screening_applications add constraint screening_applications_status_check check (status in ('pending', 'approved', 'suspended'));
alter table public.screening_applications alter column status set default 'pending';

create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  recipient_email text,
  recipient_phone text,
  kind text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_otps (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.screening_applications(id) on delete cascade,
  identifier text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.customer_notifications enable row level security;
alter table public.approval_otps enable row level security;
create policy "staff read customer notifications" on public.customer_notifications for select to authenticated using (public.current_role() is not null);
-- OTP rows intentionally have no client policies. Only service-role backend functions may access them.
