-- An approved screening application is the authoritative tracker-sale event.
-- Materialise it once for Finance, product inventory, and agent commissions.
create or replace function public.materialize_tracker_sale(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application_row public.screening_applications%rowtype;
  product_row public.bikes%rowtype;
  agent_name text;
  agent_code text;
  sale_id text;
  deposit numeric(12,2);
  total numeric(12,2);
  balance numeric(12,2);
begin
  select * into application_row
  from public.screening_applications
  where id = p_application_id;

  if not found or application_row.status <> 'approved' or application_row.customer_id is null or application_row.product_id is null then
    return;
  end if;

  select * into product_row
  from public.bikes
  where id = application_row.product_id;

  if not found then
    raise exception 'Approved sale % has no inventory product', p_application_id;
  end if;

  select full_name
    into agent_name
  from public.profiles
  where id = application_row.installer_agent_id;

  agent_code := coalesce(application_row.installer_agent_id::text, 'Unassigned');

  sale_id := 'SALE-' || application_row.id::text;
  total := greatest(coalesce(product_row.payable_amount, 0), 0);
  deposit := greatest(coalesce(application_row.deposit_amount, 0), 0);
  balance := greatest(total - deposit, 0);

  update public.bikes
     set customer_id = application_row.customer_id,
         status = 'sold',
         updated_at = now()
   where id = product_row.id;

  insert into public.finance_accounts (external_id, data, customer_id, outstanding, status, updated_at)
  values (
    sale_id,
    jsonb_build_object(
      'id', sale_id,
      'applicationId', application_row.id,
      'customerId', application_row.customer_id,
      'customer', application_row.full_name,
      'phone', coalesce(application_row.phone, ''),
      'bike', product_row.identifier,
      'model', product_row.model,
      'agentId', application_row.installer_agent_id,
      'agent', coalesce(agent_name, 'Unassigned agent'),
      'agentCode', coalesce(agent_code, application_row.installer_agent_id::text, 'Unassigned'),
      'total', total,
      'paid', deposit,
      'balance', balance,
      'status', case when balance = 0 then 'Completed' else 'On Track' end,
      'saleCommission', 500,
      'monthlyCustomerCommission', 50,
      'saleRecordedAt', coalesce(application_row.approved_at, application_row.updated_at, now())
    ),
    application_row.customer_id,
    balance,
    case when balance = 0 then 'completed' else 'active' end,
    now()
  )
  on conflict (external_id) do update
    set data = excluded.data,
        customer_id = excluded.customer_id,
        outstanding = excluded.outstanding,
        status = excluded.status,
        updated_at = now();

  if deposit > 0 then
    insert into public.finance_payments (external_id, data, updated_at)
    values (
      'DEPOSIT-' || application_row.id::text,
      jsonb_build_object(
        'id', 'DEPOSIT-' || application_row.id::text,
        'account', sale_id,
        'customer', application_row.full_name,
        'phone', coalesce(application_row.phone, ''),
        'agent', coalesce(agent_name, 'Unassigned agent'),
        'agentCode', coalesce(agent_code, application_row.installer_agent_id::text, 'Unassigned'),
        'product', product_row.identifier,
        'amount', deposit,
        'status', 'Confirmed',
        'date', coalesce(application_row.approved_at, application_row.updated_at, now())
      ),
      now()
    )
    on conflict (external_id) do nothing;
  end if;
end;
$$;

create or replace function public.on_approved_tracker_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.materialize_tracker_sale(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists screening_application_materialize_sale on public.screening_applications;
create trigger screening_application_materialize_sale
after update of status on public.screening_applications
for each row execute function public.on_approved_tracker_sale();

-- Recover approvals created before this trigger existed.
select public.materialize_tracker_sale(id)
from public.screening_applications
where status = 'approved';

notify pgrst, 'reload schema';
