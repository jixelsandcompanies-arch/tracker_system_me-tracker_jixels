alter table public.profiles
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists account_status text not null default 'pending';

alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check (account_status in ('pending', 'approved', 'rejected'));

update public.profiles set account_status = 'approved' where role <> 'support_agent';
