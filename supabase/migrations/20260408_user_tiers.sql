-- User subscription tiers
do $$ begin
  create type public.user_tier as enum ('gold','platinum','diamond');
exception when duplicate_object then null;
end $$;

alter table public.users
  add column if not exists tier public.user_tier not null default 'gold',
  add column if not exists tier_expires_at timestamptz;
