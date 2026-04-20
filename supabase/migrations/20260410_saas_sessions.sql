-- SaaS session and analysis log tables (separate from legacy extension tables)

-- user_sessions: one row per live streaming session per user
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_mins int,
  tab_url text,
  created_at timestamptz not null default now()
);

create index if not exists user_sessions_user_started_idx
  on public.user_sessions(user_id, started_at desc);

alter table public.user_sessions enable row level security;

drop policy if exists "user_sessions_service_all" on public.user_sessions;
create policy "user_sessions_service_all"
  on public.user_sessions
  using (false)
  with check (false);
-- all access via service_role (bypasses RLS)

-- user_analysis_logs: full AI analysis result per capture burst per user
create table if not exists public.user_analysis_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.user_sessions(id) on delete set null,
  captured_at timestamptz not null,
  phone_detected bool not null default false,
  eye_contact_score int not null default 0,
  smile_score int not null default 0,
  product_presenting bool not null default false,
  presenter_visible bool not null default false,
  activity_summary text,
  alert_flag bool not null default false,
  thumbnail_url text,
  raw_scores jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_analysis_logs_user_captured_idx
  on public.user_analysis_logs(user_id, captured_at desc);

create index if not exists user_analysis_logs_user_session_captured_idx
  on public.user_analysis_logs(user_id, session_id, captured_at desc);

create index if not exists user_analysis_logs_user_alert_captured_idx
  on public.user_analysis_logs(user_id, alert_flag, captured_at desc)
  where alert_flag = true;

alter table public.user_analysis_logs enable row level security;

drop policy if exists "user_analysis_logs_service_all" on public.user_analysis_logs;
create policy "user_analysis_logs_service_all"
  on public.user_analysis_logs
  using (false)
  with check (false);
-- all access via service_role (bypasses RLS)
