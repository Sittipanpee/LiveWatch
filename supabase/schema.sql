-- =============================================================================
-- LiveWatch Extension — Supabase PostgreSQL Schema
-- TikTok Shop Helper (internal: LiveWatch)
-- =============================================================================
-- คำอธิบาย: สคีมาฐานข้อมูลสำหรับระบบติดตามคุณภาพการไลฟ์สด
-- Description: Database schema for monitoring TikTok Live stream quality
-- =============================================================================

-- Enable UUID generation extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================================
-- TABLE: sessions
-- เซสชันการไลฟ์สด — บันทึกช่วงเวลาที่เปิดและปิดการไลฟ์แต่ละครั้ง
-- Records each individual TikTok Live streaming session
-- =============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  -- รหัสเซสชัน (UUID primary key)
  -- Unique session identifier
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  -- เวลาเริ่มต้นไลฟ์
  -- When the live stream started
  started_at      TIMESTAMPTZ     NOT NULL,

  -- เวลาสิ้นสุดไลฟ์ (null ถ้ายังไลฟ์อยู่)
  -- When the live stream ended; NULL while session is active
  ended_at        TIMESTAMPTZ,

  -- ระยะเวลาไลฟ์เป็นนาที (คำนวณเมื่อปิดเซสชัน)
  -- Total live duration in minutes, populated on session end
  duration_mins   INT,

  -- URL ของหน้าไลฟ์
  -- Full URL of the TikTok streamer live page
  tab_url         TEXT            NOT NULL,

  -- เวลาที่สร้างแถวในฐานข้อมูล
  -- Row creation timestamp
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE  sessions               IS 'เซสชันการไลฟ์สดแต่ละครั้ง / Individual TikTok Live sessions';
COMMENT ON COLUMN sessions.id            IS 'UUID primary key';
COMMENT ON COLUMN sessions.started_at   IS 'เวลาเริ่มต้นไลฟ์ / Live start time';
COMMENT ON COLUMN sessions.ended_at     IS 'เวลาสิ้นสุดไลฟ์ (NULL ถ้ายังไลฟ์อยู่) / Live end time, NULL if active';
COMMENT ON COLUMN sessions.duration_mins IS 'ระยะเวลาเป็นนาที / Duration in minutes';
COMMENT ON COLUMN sessions.tab_url      IS 'URL หน้าไลฟ์ / TikTok live page URL';
COMMENT ON COLUMN sessions.created_at   IS 'เวลาสร้างแถว / Row creation timestamp';


-- =============================================================================
-- TABLE: analysis_logs
-- บันทึกผลการวิเคราะห์เฟรมแต่ละชุด (burst) จาก Gemini vision
-- Per-burst AI analysis results from Pollinations / Gemini vision
-- =============================================================================

CREATE TABLE IF NOT EXISTS analysis_logs (
  -- รหัสบันทึก (UUID primary key)
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- อ้างอิงถึงเซสชันที่บันทึกนี้สังกัด
  -- Reference to the parent session
  session_id          UUID          NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- เวลาที่จับภาพเฟรม
  -- Timestamp when the frame burst was captured
  captured_at         TIMESTAMPTZ   NOT NULL,

  -- ตรวจพบมือถือในเฟรมหรือไม่
  -- Whether a phone was detected in any frame of the burst
  phone_detected      BOOL          NOT NULL DEFAULT false,

  -- คะแนนการมองกล้อง (0-100)
  -- Eye contact score across the burst (0 = never, 100 = always)
  eye_contact_score   INT           NOT NULL DEFAULT 0
                        CHECK (eye_contact_score BETWEEN 0 AND 100),

  -- คะแนนการยิ้ม (0-100)
  -- Smile score across the burst (0 = no smile, 100 = big smile)
  smile_score         INT           NOT NULL DEFAULT 0
                        CHECK (smile_score BETWEEN 0 AND 100),

  -- กำลังนำเสนอสินค้าหรือไม่
  -- Whether a product is visibly being presented
  product_presenting  BOOL          NOT NULL DEFAULT false,

  -- ผู้นำเสนอปรากฏในเฟรมหรือไม่
  -- Whether the presenter is visible in any frame
  presenter_visible   BOOL          NOT NULL DEFAULT false,

  -- คำอธิบายกิจกรรมในไลฟ์ (ภาษาไทยหรืออังกฤษ)
  -- Brief AI-generated description of what is happening in the stream
  activity_summary    TEXT,

  -- แจ้งเตือนพิเศษ (จับมือถือ หรือไม่มองกล้อง)
  -- Alert flag: true if phone in 2+ frames OR eye_contact_score < 20
  alert_flag          BOOL          NOT NULL DEFAULT false,

  -- URL ของ thumbnail ที่บันทึกไว้ (ถ้ามี)
  -- Optional URL of a stored thumbnail image for this burst
  thumbnail_url       TEXT,

  -- คะแนนดิบในรูปแบบ JSON (เก็บผลลัพธ์ทั้งหมดจาก AI)
  -- Raw JSON scores as returned by the AI (for auditing / reprocessing)
  raw_scores          JSONB,

  -- เวลาที่สร้างแถว
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  analysis_logs                   IS 'ผลการวิเคราะห์เฟรมแต่ละชุดจาก Gemini / Per-burst AI analysis results';
COMMENT ON COLUMN analysis_logs.id                IS 'UUID primary key';
COMMENT ON COLUMN analysis_logs.session_id        IS 'อ้างอิงเซสชัน / FK to sessions';
COMMENT ON COLUMN analysis_logs.captured_at       IS 'เวลาจับภาพ / Frame capture timestamp';
COMMENT ON COLUMN analysis_logs.phone_detected    IS 'ตรวจพบมือถือ / Phone detected in burst';
COMMENT ON COLUMN analysis_logs.eye_contact_score IS 'คะแนนมองกล้อง 0-100 / Eye contact score';
COMMENT ON COLUMN analysis_logs.smile_score       IS 'คะแนนยิ้ม 0-100 / Smile score';
COMMENT ON COLUMN analysis_logs.product_presenting IS 'กำลังเสนอสินค้า / Product being shown';
COMMENT ON COLUMN analysis_logs.presenter_visible  IS 'ผู้นำเสนอปรากฏในเฟรม / Presenter visible';
COMMENT ON COLUMN analysis_logs.activity_summary  IS 'คำอธิบายกิจกรรม / Activity description';
COMMENT ON COLUMN analysis_logs.alert_flag        IS 'แจ้งเตือน / Alert triggered';
COMMENT ON COLUMN analysis_logs.thumbnail_url     IS 'URL รูปภาพ / Thumbnail URL';
COMMENT ON COLUMN analysis_logs.raw_scores        IS 'ผลลัพธ์ดิบ JSON / Raw AI output';
COMMENT ON COLUMN analysis_logs.created_at        IS 'เวลาสร้างแถว / Row creation timestamp';


-- =============================================================================
-- TABLE: daily_summaries
-- สรุปรายวัน — คำนวณเมื่อสิ้นวัน แล้วส่ง LINE
-- End-of-day aggregated summary, one row per calendar date
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_summaries (
  -- รหัสสรุปรายวัน (UUID primary key)
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- วันที่สรุป (unique ไม่ซ้ำกัน)
  -- Calendar date of this summary (one row per day)
  summary_date            DATE          NOT NULL UNIQUE,

  -- จำนวนนาทีทั้งหมดที่ไลฟ์ในวันนี้
  -- Total minutes live across all sessions on this date
  total_live_mins         INT           NOT NULL DEFAULT 0,

  -- จำนวนชุดเฟรมที่วิเคราะห์ทั้งหมด
  -- Total number of analysis bursts completed today
  total_bursts            INT           NOT NULL DEFAULT 0,

  -- จำนวนครั้งที่เกิด alert flag
  -- Total number of analysis_logs with alert_flag = true today
  alert_count             INT           NOT NULL DEFAULT 0,

  -- จำนวนครั้งที่ตรวจพบมือถือ
  -- Total number of analysis_logs with phone_detected = true today
  phone_incidents         INT           NOT NULL DEFAULT 0,

  -- คะแนนยิ้มเฉลี่ย (ทศนิยม 1 ตำแหน่ง)
  -- Average smile score for the day
  avg_smile_score         NUMERIC(4,1)  NOT NULL DEFAULT 0.0,

  -- คะแนนมองกล้องเฉลี่ย (ทศนิยม 1 ตำแหน่ง)
  -- Average eye contact score for the day
  avg_eye_contact_score   NUMERIC(4,1)  NOT NULL DEFAULT 0.0,

  -- เปอร์เซ็นต์เวลาที่เสนอสินค้า (ทศนิยม 1 ตำแหน่ง)
  -- Percentage of bursts where product_presenting = true
  product_presenting_pct  NUMERIC(4,1)  NOT NULL DEFAULT 0.0,

  -- เวลาที่ส่งข้อความ LINE (null ถ้ายังไม่ส่ง)
  -- Timestamp when the LINE summary message was sent; NULL if not yet sent
  line_sent_at            TIMESTAMPTZ,

  -- เวลาที่สร้างแถว
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  daily_summaries                       IS 'สรุปรายวัน / End-of-day aggregated summary';
COMMENT ON COLUMN daily_summaries.id                    IS 'UUID primary key';
COMMENT ON COLUMN daily_summaries.summary_date          IS 'วันที่สรุป (unique) / Summary calendar date';
COMMENT ON COLUMN daily_summaries.total_live_mins       IS 'นาทีไลฟ์ทั้งหมด / Total live minutes';
COMMENT ON COLUMN daily_summaries.total_bursts          IS 'จำนวนชุดวิเคราะห์ / Total analysis bursts';
COMMENT ON COLUMN daily_summaries.alert_count           IS 'จำนวนการแจ้งเตือน / Total alerts triggered';
COMMENT ON COLUMN daily_summaries.phone_incidents       IS 'ครั้งที่พบมือถือ / Phone detection count';
COMMENT ON COLUMN daily_summaries.avg_smile_score       IS 'คะแนนยิ้มเฉลี่ย / Average smile score';
COMMENT ON COLUMN daily_summaries.avg_eye_contact_score IS 'คะแนนมองกล้องเฉลี่ย / Average eye contact score';
COMMENT ON COLUMN daily_summaries.product_presenting_pct IS '% เวลาเสนอสินค้า / Product presenting %';
COMMENT ON COLUMN daily_summaries.line_sent_at          IS 'เวลาส่ง LINE / LINE message sent timestamp';
COMMENT ON COLUMN daily_summaries.created_at            IS 'เวลาสร้างแถว / Row creation timestamp';


-- =============================================================================
-- INDEXES — ปรับปรุงประสิทธิภาพ query ที่ใช้บ่อย
-- Indexes for common query patterns
-- =============================================================================

-- sessions: หา session ตาม started_at (เรียงจากล่าสุด)
-- Find sessions by start time, most recent first
CREATE INDEX IF NOT EXISTS idx_sessions_started_at
  ON sessions (started_at DESC);

-- sessions: หา session ที่ยังไม่มี ended_at (กำลังไลฟ์อยู่)
-- Find active sessions (no ended_at)
CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON sessions (started_at DESC)
  WHERE ended_at IS NULL;

-- analysis_logs: join กับ session_id + เรียงตาม captured_at
-- Support session-level queries ordered by capture time
CREATE INDEX IF NOT EXISTS idx_analysis_logs_session_captured
  ON analysis_logs (session_id, captured_at DESC);

-- analysis_logs: กรองเฉพาะแถวที่มี alert
-- Quickly filter alert records
CREATE INDEX IF NOT EXISTS idx_analysis_logs_alert_flag
  ON analysis_logs (alert_flag, captured_at DESC)
  WHERE alert_flag = true;

-- analysis_logs: query ตามวันที่ (สำหรับสรุปรายวัน)
-- Date-range queries using captured_at range (e.g. WHERE captured_at >= today)
CREATE INDEX IF NOT EXISTS idx_analysis_logs_captured_at
  ON analysis_logs (captured_at DESC);

-- daily_summaries: หาตามวันที่
-- Direct lookup by summary date
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date
  ON daily_summaries (summary_date DESC);


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- เปิดใช้งาน RLS บนทุกตาราง และอนุญาตเฉพาะ service role เท่านั้น
-- Enable RLS on all tables; only the service role bypass is allowed
-- =============================================================================

ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries  ENABLE ROW LEVEL SECURITY;

-- Policy: อนุญาตให้ service role อ่าน/เขียนทุกแถว
-- Allow full access only via the service role key (used by the extension backend)
-- anon and authenticated roles are denied by default when no policy matches.

CREATE POLICY "service_role_all_sessions"
  ON sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_all_analysis_logs"
  ON analysis_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_all_daily_summaries"
  ON daily_summaries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
