-- =============================================================================
-- LiveWatch — Complete Setup (run this once in Supabase SQL Editor)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  duration_mins INT,
  tab_url       TEXT,                          -- nullable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analysis_logs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID        REFERENCES sessions(id) ON DELETE CASCADE, -- nullable
  captured_at        TIMESTAMPTZ NOT NULL,
  phone_detected     BOOL        NOT NULL DEFAULT false,
  eye_contact_score  INT         NOT NULL DEFAULT 0 CHECK (eye_contact_score BETWEEN 0 AND 100),
  smile_score        INT         NOT NULL DEFAULT 0 CHECK (smile_score BETWEEN 0 AND 100),
  product_presenting BOOL        NOT NULL DEFAULT false,
  presenter_visible  BOOL        NOT NULL DEFAULT false,
  activity_summary   TEXT,
  alert_flag         BOOL        NOT NULL DEFAULT false,
  thumbnail_url      TEXT,
  raw_scores         JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date           DATE         NOT NULL UNIQUE,
  total_live_mins        INT          NOT NULL DEFAULT 0,
  total_bursts           INT          NOT NULL DEFAULT 0,
  alert_count            INT          NOT NULL DEFAULT 0,
  phone_incidents        INT          NOT NULL DEFAULT 0,
  avg_smile_score        NUMERIC(4,1) NOT NULL DEFAULT 0.0,
  avg_eye_contact_score  NUMERIC(4,1) NOT NULL DEFAULT 0.0,
  product_presenting_pct NUMERIC(4,1) NOT NULL DEFAULT 0.0,
  line_sent_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sessions_started_at
  ON sessions (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON sessions (started_at DESC) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_analysis_logs_session_captured
  ON analysis_logs (session_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_logs_alert
  ON analysis_logs (alert_flag, captured_at DESC) WHERE alert_flag = true;

CREATE INDEX IF NOT EXISTS idx_analysis_logs_captured_at
  ON analysis_logs (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_date
  ON daily_summaries (summary_date DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;

-- service_role: full access (bypasses RLS)
CREATE POLICY "svc_sessions"  ON sessions        FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_analysis"  ON analysis_logs   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_daily"     ON daily_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);

-- anon (publishable key): read + write
CREATE POLICY "anon_sessions_ins" ON sessions        FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_sessions_sel" ON sessions        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_sessions_upd" ON sessions        FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_analysis_ins" ON analysis_logs   FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_analysis_sel" ON analysis_logs   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_daily_ins"    ON daily_summaries FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_daily_sel"    ON daily_summaries FOR SELECT TO anon USING (true);
CREATE POLICY "anon_daily_upd"    ON daily_summaries FOR UPDATE TO anon USING (true) WITH CHECK (true);
