-- New customer registrations wait for an administrator decision.
-- Existing customer records retain their current state.
alter table public.customers alter column status set default 'pending';
