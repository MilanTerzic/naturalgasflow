-- Gas dashboard authorization layer.
-- Supabase Auth may be shared with Power Pulse so credentials are identical,
-- while this gas-specific table keeps application approval separate.

create table if not exists public.gas_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','disabled')),
  role text not null default 'user'
    check (role in ('user','admin')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  last_login_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists gas_user_access_email_lower_idx
  on public.gas_user_access (lower(email));

alter table public.gas_user_access enable row level security;

drop policy if exists "users can read own gas access state" on public.gas_user_access;
create policy "users can read own gas access state"
  on public.gas_user_access
  for select
  to authenticated
  using (auth.uid() = user_id);
