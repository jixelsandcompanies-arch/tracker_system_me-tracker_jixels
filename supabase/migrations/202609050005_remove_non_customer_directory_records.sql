-- The legacy customer view could include profiles from every workspace.
-- Only a profile explicitly registered as a customer belongs in the directory.
delete from public.customers as customer
using public.profiles as profile
where customer.id = profile.id
  and profile.role <> 'customer'::public.app_role;

notify pgrst, 'reload schema';
