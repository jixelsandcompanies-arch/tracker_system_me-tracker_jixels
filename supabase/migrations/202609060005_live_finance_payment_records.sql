-- Keep Finance, Admin, and the mobile apps on the same operational data.
-- Finance rows are materialized only from approved sales and confirmed M-Pesa
-- payments; no browser-created values or internal UUID references are shown.

alter table public.payments
  add column if not exists payment_type text not null default 'daily';

update public.payments
set payment_type = 'deposit'
where payment_reference like 'DEP-%'
  and payment_type = 'daily';

insert into public.finance_settings (id, data, updated_at)
values (
  'default',
  jsonb_build_object('workspaceName', '', 'saleCommission', 5000, 'monthlyCustomerCommission', 50),
  now()
)
on conflict (id) do update
set data = jsonb_set(
             jsonb_set(coalesce(finance_settings.data, '{}'::jsonb), '{saleCommission}', '5000'::jsonb, true),
             '{monthlyCustomerCommission}', '50'::jsonb,
             true
           ),
    updated_at = now();

create or replace function public.materialize_tracker_sale(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application_row public.screening_applications%rowtype;
  product_row public.bikes%rowtype;
  customer_row public.customers%rowtype;
  agent_name text;
  agent_code text;
  tracker_code text;
  account_id text;
  total numeric(12,2);
  confirmed_total numeric(12,2);
  confirmed_deposit numeric(12,2);
  balance numeric(12,2);
  payment_row record;
begin
  select * into application_row
  from public.screening_applications
  where id = p_application_id;

  if not found or application_row.status <> 'approved' or application_row.customer_id is null or application_row.product_id is null then
    return;
  end if;

  select * into product_row from public.bikes where id = application_row.product_id;
  if not found then
    raise exception 'Approved sale % has no inventory product', p_application_id;
  end if;
  select * into customer_row from public.customers where id = application_row.customer_id;
  if not found then
    raise exception 'Approved sale % has no customer', p_application_id;
  end if;

  select profile.full_name, profile.agent_code into agent_name, agent_code
  from public.profiles profile
  where profile.id = application_row.installer_agent_id;

  select identifier into tracker_code
  from public.trackers
  where bike_id = application_row.product_id
  order by created_at asc nulls last
  limit 1;
  tracker_code := coalesce(application_row.tracker_identifier, tracker_code, product_row.identifier);
  account_id := 'ACC-' || coalesce(customer_row.customer_code, upper(left(application_row.customer_id::text, 8)));
  total := greatest(coalesce(product_row.payable_amount, 0), 0);

  select
    coalesce(sum(amount) filter (where lower(coalesce(payment_type, 'daily')) = 'deposit'), 0),
    coalesce(sum(amount), 0)
  into confirmed_deposit, confirmed_total
  from public.payments
  where customer_id = application_row.customer_id
    and product_id = application_row.product_id
    and lower(status) in ('paid', 'completed', 'confirmed');
  balance := greatest(total - confirmed_total, 0);

  update public.bikes
     set customer_id = application_row.customer_id,
         status = 'sold',
         updated_at = now()
   where id = product_row.id;

  update public.customers
     set status = 'active',
         tracker_number = tracker_code,
         updated_at = now()
   where id = application_row.customer_id;

  -- Replace legacy UUID-based Finance records for this sale with a short,
  -- customer-facing account identifier and exact confirmed payment rows.
  delete from public.finance_accounts
   where customer_id = application_row.customer_id
      or data ->> 'applicationId' = application_row.id::text;
  insert into public.finance_accounts (external_id, data, customer_id, outstanding, status, updated_at)
  values (
    account_id,
    jsonb_build_object(
      'id', account_id,
      'applicationId', application_row.id,
      'customerId', application_row.customer_id,
      'customerCode', customer_row.customer_code,
      'customer', application_row.full_name,
      'phone', coalesce(application_row.phone, customer_row.phone, ''),
      'email', coalesce(application_row.email, customer_row.email, ''),
      'bike', product_row.identifier,
      'model', product_row.model,
      'tracker', tracker_code,
      'agentId', application_row.installer_agent_id,
      'agent', coalesce(agent_name, 'Unassigned agent'),
      'agentCode', coalesce(agent_code, 'Unassigned'),
      'total', total,
      'paid', confirmed_total,
      'deposit', confirmed_deposit,
      'balance', balance,
      'status', case when balance = 0 then 'Completed' else 'On Track' end,
      'saleRecordedAt', coalesce(application_row.approved_at, application_row.updated_at, now())
    ),
    application_row.customer_id,
    balance,
    case when balance = 0 then 'completed' else 'active' end,
    now()
  );

  delete from public.finance_payments
   where data ->> 'customerId' = application_row.customer_id::text
      or data ->> 'applicationId' = application_row.id::text
      or external_id = 'DEPOSIT-' || application_row.id::text;

  for payment_row in
    select id, amount, payment_type, receipt_number, paid_at, created_at
    from public.payments
    where customer_id = application_row.customer_id
      and product_id = application_row.product_id
      and lower(status) in ('paid', 'completed', 'confirmed')
    order by coalesce(paid_at, created_at) asc
  loop
    insert into public.finance_payments (external_id, data, updated_at)
    values (
      'PAY-' || payment_row.id::text,
      jsonb_build_object(
        'id', 'PAY-' || payment_row.id::text,
        'applicationId', application_row.id,
        'customerId', application_row.customer_id,
        'account', account_id,
        'customer', application_row.full_name,
        'phone', coalesce(application_row.phone, customer_row.phone, ''),
        'email', coalesce(application_row.email, customer_row.email, ''),
        'agent', coalesce(agent_name, 'Unassigned agent'),
        'agentCode', coalesce(agent_code, 'Unassigned'),
        'product', product_row.identifier,
        'tracker', tracker_code,
        'health', 'Unknown',
        'paymentType', case when lower(coalesce(payment_row.payment_type, 'daily')) = 'deposit' then 'Deposit' else 'Daily payment' end,
        'receipt', nullif(payment_row.receipt_number, ''),
        'amount', payment_row.amount,
        'balance', balance,
        'status', 'Confirmed',
        'date', coalesce(payment_row.paid_at, payment_row.created_at)
      ),
      now()
    );
  end loop;
end;
$$;

-- Existing approved customers are rebuilt once so legacy UUID Finance rows
-- disappear immediately after this migration is applied.
select public.materialize_tracker_sale(id)
from public.screening_applications
where status = 'approved';

-- Publish the tables driving live portal state. Existing applications are not
-- re-added, so this remains safe when the migration is replayed.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customers', 'bikes', 'trackers', 'tracker_heartbeats', 'payments',
    'screening_applications', 'profiles', 'finance_accounts',
    'finance_payments', 'finance_alerts', 'finance_settings', 'alerts'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null
       and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

create index if not exists payments_customer_product_confirmed_idx
  on public.payments(customer_id, product_id, paid_at desc)
  where lower(status) in ('paid', 'completed', 'confirmed');

notify pgrst, 'reload schema';
