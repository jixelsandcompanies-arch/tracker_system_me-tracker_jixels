-- A payment callback and a repeated M-Pesa callback can materialize the same
-- approved sale concurrently. Serialize reconciliation per customer and bike
-- so an older payment sum cannot overwrite the balance after a newer one.
alter function public.materialize_tracker_sale(uuid)
  rename to materialize_tracker_sale_unserialized;

create function public.materialize_tracker_sale(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_customer_id uuid;
  sale_product_id uuid;
begin
  select customer_id, product_id
    into sale_customer_id, sale_product_id
  from public.screening_applications
  where id = p_application_id;

  if sale_customer_id is not null and sale_product_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(sale_customer_id::text || ':' || sale_product_id::text, 0)
    );
  end if;

  perform public.materialize_tracker_sale_unserialized(p_application_id);
end;
$$;

revoke all on function public.materialize_tracker_sale(uuid) from public, anon, authenticated;
revoke all on function public.materialize_tracker_sale_unserialized(uuid) from public, anon, authenticated;
grant execute on function public.materialize_tracker_sale(uuid) to service_role;

-- Rebuild approved accounts through the new serialized entry point once.
select public.materialize_tracker_sale(id)
from public.screening_applications
where status = 'approved';

notify pgrst, 'reload schema';
