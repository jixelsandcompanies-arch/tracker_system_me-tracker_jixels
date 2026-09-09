-- Agent commission rules:
--   KES 200 once for each approved/sold tracker product.
--   KES 50 for each confirmed non-deposit Lipa Mdogo Mdogo installment.
-- The application calculates monthly installments from confirmed payment rows.

insert into public.finance_settings (id, data, updated_at)
values (
  'default',
  jsonb_build_object('workspaceName', '', 'saleCommission', 200, 'monthlyCustomerCommission', 50),
  now()
)
on conflict (id) do update
set data = jsonb_set(
             jsonb_set(coalesce(finance_settings.data, '{}'::jsonb), '{saleCommission}', '200'::jsonb, true),
             '{monthlyCustomerCommission}', '50'::jsonb,
             true
           ),
    updated_at = now();

notify pgrst, 'reload schema';
