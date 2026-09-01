alter table public.bikes
  add column if not exists payable_amount numeric(12, 2) not null default 0 check (payable_amount >= 0);
