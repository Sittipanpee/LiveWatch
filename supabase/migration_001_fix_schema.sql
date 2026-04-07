-- =============================================================================
-- Migration 001: Fix schema for Chrome Extension (anon key) compatibility
-- =============================================================================
-- ปัญหาที่แก้:
-- 1. tab_url NOT NULL → nullable (extension ไม่ได้ส่ง URL ตอน insert เสมอไป)
-- 2. เพิ่ม RLS policies สำหรับ anon role (extension ใช้ anon key ไม่ใช่ service_role)
-- 3. ลบ NOT NULL constraint ออกจาก analysis_logs.session_id
--    เพื่อรองรับกรณี Supabase ยังไม่มี session (session_id = null)
-- =============================================================================

-- ── 1. Fix sessions table ──────────────────────────────────────────────────

-- tab_url เป็น nullable (extension อาจไม่รู้ URL ตอน startSession)
ALTER TABLE sessions
  ALTER COLUMN tab_url DROP NOT NULL;

-- ── 2. Fix analysis_logs table ─────────────────────────────────────────────

-- session_id เป็น nullable เพื่อรองรับกรณีที่ยังไม่มี session id (offline insert)
ALTER TABLE analysis_logs
  ALTER COLUMN session_id DROP NOT NULL;

-- ── 3. RLS Policies สำหรับ anon role ──────────────────────────────────────
-- Extension ใช้ anon key → ต้องมี policy ที่อนุญาต anon

-- sessions
CREATE POLICY "anon_insert_sessions"
  ON sessions FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_select_sessions"
  ON sessions FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_update_sessions"
  ON sessions FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- analysis_logs
CREATE POLICY "anon_insert_analysis_logs"
  ON analysis_logs FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_select_analysis_logs"
  ON analysis_logs FOR SELECT TO anon
  USING (true);

-- daily_summaries
CREATE POLICY "anon_insert_daily_summaries"
  ON daily_summaries FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_select_daily_summaries"
  ON daily_summaries FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_upsert_daily_summaries"
  ON daily_summaries FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
