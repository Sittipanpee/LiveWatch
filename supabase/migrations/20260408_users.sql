-- LiveWatch SaaS: users table + RLS.
-- Bridges Supabase auth.users to LINE pairing state.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  pairing_code text unique,
  pairing_code_expires_at timestamptz,
  line_user_id text unique,
  paired_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists users_pairing_code_idx
  on public.users (pairing_code)
  where pairing_code is not null;

alter table public.users enable row level security;

-- Users can read their own row.
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
  on public.users for select
  using (auth.uid() = id);

-- Users can update their own row (for profile fields). The LINE webhook uses
-- the service_role key which bypasses RLS, so line_user_id writes don't need
-- a dedicated policy here.
drop policy if exists "users_update_own_limited" on public.users;
create policy "users_update_own_limited"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- NO anon insert/delete policies. Inserts happen via service_role during
-- pairing-code regeneration.
