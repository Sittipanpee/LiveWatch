-- LiveWatch SaaS: api_tokens for Chrome extension authentication.
-- Tokens are stored as sha256 hashes; plaintext is shown to user only on creation.

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Chrome Extension',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_tokens_user_id_idx
  on public.api_tokens(user_id) where revoked_at is null;
create index if not exists api_tokens_hash_idx
  on public.api_tokens(token_hash) where revoked_at is null;

alter table public.api_tokens enable row level security;

drop policy if exists "api_tokens_select_own" on public.api_tokens;
create policy "api_tokens_select_own"
  on public.api_tokens for select
  using (auth.uid() = user_id);
-- inserts/updates/deletes via service_role only (bypasses RLS)
