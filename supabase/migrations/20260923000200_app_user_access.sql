-- Individual account approval layer for the gas dashboard.
-- Supabase Auth owns credentials. This table stores only application access state.

create table if not exists public.app_user_access (
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

create unique index if not exists app_user_access_email_lower_idx
  on public.app_user_access (lower(email));

alter table public.app_user_access enable row level security;

drop policy if exists "users can read own access state" on public.app_user_access;
create policy "users can read own access state"
  on public.app_user_access
  for select
  to authenticated
  using (auth.uid() = user_id);
