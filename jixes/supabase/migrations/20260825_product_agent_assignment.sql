alter table public.bikes
  add column if not exists assigned_agent_id uuid references public.profiles(id) on delete set null;

create index if not exists bikes_assigned_agent_id_idx on public.bikes (assigned_agent_id);
