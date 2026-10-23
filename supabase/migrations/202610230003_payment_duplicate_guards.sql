-- A single M-Pesa receipt must resolve to one canonical payment record.
create unique index if not exists payments_receipt_number_unique_idx
  on public.payments (receipt_number)
  where receipt_number is not null and btrim(receipt_number) <> '';

-- Speed up lookups that prevent repeat deposit prompts for a vehicle.
create index if not exists payments_processing_deposit_vehicle_idx
  on public.payments (customer_id, product_id, created_at desc)
  where payment_type = 'deposit' and status = 'processing';

-- Duplicate callback rows should never be shown or included in balances.
notify pgrst, 'reload schema';
