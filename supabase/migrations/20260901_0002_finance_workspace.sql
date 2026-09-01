create table if not exists public.finance_workspace_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.finance_workspace_state enable row level security;
drop policy if exists "finance users manage their workspace" on public.finance_workspace_state;
create policy "finance users manage their workspace" on public.finance_workspace_state
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
