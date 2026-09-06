-- Operational references, payment-prompt state, and indexes for high-frequency workspaces.
create sequence if not exists public.customer_reference_sequence start with 1;
create sequence if not exists public.agent_reference_sequence start with 1;

alter table public.customers add column if not exists customer_code text;
alter table public.profiles add column if not exists agent_code text;
alter table public.screening_applications add column if not exists requested_deposit_amount numeric(12,2) not null default 0;
alter table public.payments add column if not exists payer_phone text;
alter table public.payments add column if not exists prompted_by uuid references public.profiles(id) on delete set null;
alter table public.payments add column if not exists payment_reference text;
alter table public.payments add column if not exists checkout_request_id text;

update public.customers
set customer_code = 'CM-' || lpad(nextval('public.customer_reference_sequence')::text, 3, '0')
where customer_code is null;

update public.profiles
set agent_code = 'AG-' || lpad(nextval('public.agent_reference_sequence')::text, 3, '0')
where agent_code is null
  and role in ('agent', 'support_agent');

update public.screening_applications
set requested_deposit_amount = deposit_amount,
    deposit_amount = 0
where requested_deposit_amount = 0
  and deposit_amount > 0
  and not exists (
    select 1 from public.payments payment
    where payment.customer_id = screening_applications.customer_id
      and payment.product_id = screening_applications.product_id
      and payment.status in ('paid', 'completed', 'confirmed')
  );

alter table public.customers alter column customer_code set default ('CM-' || lpad(nextval('public.customer_reference_sequence')::text, 3, '0'));
create or replace function public.assign_agent_reference_code()
returns trigger language plpgsql as $$
begin
  if new.agent_code is null and new.role in ('agent', 'support_agent') then
    new.agent_code := 'AG-' || lpad(nextval('public.agent_reference_sequence')::text, 3, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_assign_agent_reference_code on public.profiles;
create trigger profiles_assign_agent_reference_code
before insert or update of role on public.profiles
for each row execute function public.assign_agent_reference_code();
create unique index if not exists customers_customer_code_unique_idx on public.customers(customer_code) where customer_code is not null;
create unique index if not exists profiles_agent_code_unique_idx on public.profiles(agent_code) where agent_code is not null;
create unique index if not exists payments_payment_reference_unique_idx on public.payments(payment_reference) where payment_reference is not null;
create unique index if not exists payments_checkout_request_unique_idx on public.payments(checkout_request_id) where checkout_request_id is not null;
create index if not exists screening_applications_agent_created_idx on public.screening_applications(installer_agent_id, created_at desc);
create index if not exists screening_applications_customer_product_idx on public.screening_applications(customer_id, product_id);
create index if not exists payments_customer_product_status_idx on public.payments(customer_id, product_id, status, created_at desc);
create index if not exists bikes_assigned_agent_created_idx on public.bikes(assigned_agent_id, created_at desc);

notify pgrst, 'reload schema';
