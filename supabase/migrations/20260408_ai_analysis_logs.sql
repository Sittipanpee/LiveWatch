create table if not exists public.ai_analysis_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ai_analysis_logs_user_created_idx
  on public.ai_analysis_logs(user_id, created_at desc);

alter table public.ai_analysis_logs enable row level security;

drop policy if exists "ai_logs_select_own" on public.ai_analysis_logs;
create policy "ai_logs_select_own"
  on public.ai_analysis_logs for select
  using (auth.uid() = user_id);
-- inserts via service_role only (bypasses RLS)
