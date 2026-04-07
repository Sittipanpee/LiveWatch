-- =============================================================================
-- LiveWatch Extension — Migration 002: Stats Timeline & Chat Logs
-- TikTok Shop Helper (internal: LiveWatch)
-- =============================================================================
-- คำอธิบาย: เพิ่มตารางสำหรับเก็บ stats poll และข้อความแชทระหว่างไลฟ์
-- Description: Add stats_timeline and chat_logs tables, extend sessions table,
--              and create session_peak_stats helper view
-- =============================================================================


-- =============================================================================
-- TABLE: stats_timeline
-- บันทึก stats ทุก 30 วินาทีระหว่างไลฟ์ (viewer count, GMV, ฯลฯ)
-- One row per 30-second stats poll, tied to a live session
-- =============================================================================

CREATE TABLE IF NOT EXISTS stats_timeline (
  -- รหัสแถว (UUID primary key)
  -- Unique row identifier
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- อ้างอิงถึงเซสชันที่บันทึกนี้สังกัด
  -- Reference to the parent session
  session_id      UUID          NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- เวลาที่ poll stats ครั้งนี้
  -- Timestamp when this stats snapshot was polled
  polled_at       TIMESTAMPTZ   NOT NULL,

  -- จำนวนผู้ชมปัจจุบัน
  -- Current viewer count at poll time
  viewer_count    INT,

  -- จำนวนไลก์สะสม
  -- Cumulative like count at poll time
  like_count      INT,

  -- GMV สะสมในหน่วยสตางค์ (หลีกเลี่ยงปัญหา float)
  -- Cumulative GMV stored in satang to avoid float precision issues
  gmv_satang      BIGINT,

  -- จำนวนหน่วยที่ขายได้สะสม
  -- Cumulative units sold at poll time
  units_sold      INT,

  -- จำนวนคลิกสินค้าสะสม
  -- Cumulative product click count at poll time
  product_clicks  INT,

  -- CTR ในหน่วย basis points (1.25% = 125)
  -- Click-through rate in basis points (e.g. 1.25% → 125)
  ctr_bps         INT,

  -- สถานะห้องไลฟ์ (2=กำลังไลฟ์, 4=จบแล้ว)
  -- Live room status code: 2 = live, 4 = ended
  room_status     INT,

  -- แหล่งที่มาของ stats ('api' หรือ 'dom')
  -- Data source: 'api' for TikTok API, 'dom' for page scraping
  source          TEXT          NOT NULL DEFAULT 'api',

  -- raw response จาก API เต็มรูปแบบ (สำหรับ debug)
  -- Full raw API response payload for debugging and reprocessing
  raw_payload     JSONB,

  -- เวลาที่สร้างแถว
  -- Row creation timestamp
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  stats_timeline                IS 'Stats poll ทุก 30 วินาทีระหว่างไลฟ์ / 30-second stats snapshots during a live session';
COMMENT ON COLUMN stats_timeline.id             IS 'UUID primary key';
COMMENT ON COLUMN stats_timeline.session_id     IS 'อ้างอิงเซสชัน / FK to sessions';
COMMENT ON COLUMN stats_timeline.polled_at      IS 'เวลา poll / Stats poll timestamp';
COMMENT ON COLUMN stats_timeline.viewer_count   IS 'จำนวนผู้ชม / Current viewer count';
COMMENT ON COLUMN stats_timeline.like_count     IS 'จำนวนไลก์ / Cumulative like count';
COMMENT ON COLUMN stats_timeline.gmv_satang     IS 'GMV สะสม (สตางค์) / Cumulative GMV in satang';
COMMENT ON COLUMN stats_timeline.units_sold     IS 'หน่วยที่ขาย / Cumulative units sold';
COMMENT ON COLUMN stats_timeline.product_clicks IS 'คลิกสินค้า / Cumulative product clicks';
COMMENT ON COLUMN stats_timeline.ctr_bps        IS 'CTR (basis points) / CTR in basis points, e.g. 125 = 1.25%';
COMMENT ON COLUMN stats_timeline.room_status    IS 'สถานะห้อง / Room status: 2=live, 4=ended';
COMMENT ON COLUMN stats_timeline.source         IS 'แหล่งข้อมูล / Data source: api or dom';
COMMENT ON COLUMN stats_timeline.raw_payload    IS 'raw API response / Full raw API payload for debugging';
COMMENT ON COLUMN stats_timeline.created_at     IS 'เวลาสร้างแถว / Row creation timestamp';


-- =============================================================================
-- TABLE: chat_logs
-- บันทึกข้อความแชทระหว่างไลฟ์ (comment, order, system)
-- One row per captured chat message during a live session
-- =============================================================================

CREATE TABLE IF NOT EXISTS chat_logs (
  -- รหัสแถว (UUID primary key)
  -- Unique row identifier
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- อ้างอิงถึงเซสชันที่ข้อความนี้สังกัด
  -- Reference to the parent session
  session_id  UUID          NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- เวลาที่ข้อความปรากฏบนหน้าจอ
  -- Timestamp when the message appeared in the live chat
  ts          TIMESTAMPTZ   NOT NULL,

  -- ชื่อผู้ใช้ที่ส่งข้อความ (อาจเป็น null สำหรับข้อความ system)
  -- Sender username; NULL for system-generated messages
  username    TEXT,

  -- เนื้อหาข้อความ
  -- Chat message text content
  text        TEXT          NOT NULL,

  -- ประเภทข้อความ ('comment', 'order', 'system')
  -- Message type: 'comment' for regular chat, 'order' for purchase events, 'system' for platform notices
  msg_type    TEXT          NOT NULL DEFAULT 'comment',

  -- 200 ตัวอักษรแรกของ DOM node (สำหรับ debug)
  -- First 200 characters of the DOM node innerText for debugging
  raw_node    TEXT,

  -- เวลาที่สร้างแถว
  -- Row creation timestamp
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  chat_logs              IS 'ข้อความแชทระหว่างไลฟ์ / Chat messages captured during a live session';
COMMENT ON COLUMN chat_logs.id           IS 'UUID primary key';
COMMENT ON COLUMN chat_logs.session_id   IS 'อ้างอิงเซสชัน / FK to sessions';
COMMENT ON COLUMN chat_logs.ts           IS 'เวลาที่ข้อความปรากฏ / Message appearance timestamp';
COMMENT ON COLUMN chat_logs.username     IS 'ชื่อผู้ส่ง / Sender username';
COMMENT ON COLUMN chat_logs.text         IS 'เนื้อหาข้อความ / Message text';
COMMENT ON COLUMN chat_logs.msg_type     IS 'ประเภทข้อความ / Message type: comment, order, or system';
COMMENT ON COLUMN chat_logs.raw_node     IS 'DOM node ดิบ (200 ตัวอักษรแรก) / Raw DOM node innerText for debugging';
COMMENT ON COLUMN chat_logs.created_at   IS 'เวลาสร้างแถว / Row creation timestamp';


-- =============================================================================
-- ALTER TABLE: sessions
-- เพิ่มคอลัมน์สรุป stats และสถานะห้องลงในตาราง sessions
-- Extend sessions with aggregate stats and room lifecycle columns
-- =============================================================================

-- ยอดผู้ชมสูงสุดตลอดเซสชัน
-- Peak concurrent viewer count across the session
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS peak_viewers          INT;

-- GMV สุดท้าย ณ เวลาจบไลฟ์ (สตางค์)
-- Final cumulative GMV at session end, stored in satang
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS final_gmv_satang      BIGINT;

-- จำนวนหน่วยที่ขายได้ทั้งหมดในเซสชัน
-- Final cumulative units sold at session end
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS final_units_sold      INT;

-- สถานะห้องล่าสุด (2=กำลังไลฟ์, 4=จบแล้ว)
-- Latest known room status: 2 = live, 4 = ended
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS room_status           INT DEFAULT 2;

-- สรุป sentiment ของแชทในรูปแบบ JSON
-- AI-generated chat sentiment summary stored as JSON
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS chat_sentiment_summary JSONB;

-- เวลาที่ส่งสรุปผ่าน LINE (null ถ้ายังไม่ส่ง)
-- Timestamp when the LINE session summary was sent; NULL if not yet sent
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS line_summary_sent_at  TIMESTAMPTZ;

COMMENT ON COLUMN sessions.peak_viewers            IS 'ยอดผู้ชมสูงสุด / Peak viewer count for the session';
COMMENT ON COLUMN sessions.final_gmv_satang        IS 'GMV สุดท้าย (สตางค์) / Final cumulative GMV in satang';
COMMENT ON COLUMN sessions.final_units_sold        IS 'หน่วยขายทั้งหมด / Final cumulative units sold';
COMMENT ON COLUMN sessions.room_status             IS 'สถานะห้อง / Room status: 2=live, 4=ended';
COMMENT ON COLUMN sessions.chat_sentiment_summary  IS 'สรุป sentiment แชท JSON / Chat sentiment summary JSON';
COMMENT ON COLUMN sessions.line_summary_sent_at    IS 'เวลาส่งสรุป LINE / LINE summary sent timestamp';


-- =============================================================================
-- INDEXES — ปรับปรุงประสิทธิภาพ query ที่ใช้บ่อยสำหรับตารางใหม่
-- Indexes for common query patterns on the new tables
-- =============================================================================

-- stats_timeline: join กับ session_id + เรียงตาม polled_at
-- Support session-level stats queries ordered by poll time
CREATE INDEX IF NOT EXISTS idx_stats_timeline_session_polled
  ON stats_timeline (session_id, polled_at DESC);

-- stats_timeline: query ตามช่วงเวลา (สำหรับ dashboard)
-- Date-range queries across all sessions
CREATE INDEX IF NOT EXISTS idx_stats_timeline_polled_at
  ON stats_timeline (polled_at DESC);

-- stats_timeline: กรองเฉพาะห้องที่จบแล้ว (room_status = 4)
-- Quickly find sessions that have ended
CREATE INDEX IF NOT EXISTS idx_stats_timeline_room_status
  ON stats_timeline (room_status)
  WHERE room_status = 4;

-- chat_logs: join กับ session_id + เรียงตาม ts
-- Support session-level chat queries ordered by message time
CREATE INDEX IF NOT EXISTS idx_chat_logs_session_ts
  ON chat_logs (session_id, ts DESC);

-- chat_logs: กรองเฉพาะข้อความ order (สำหรับสรุปยอดขาย)
-- Quickly filter order messages per session
CREATE INDEX IF NOT EXISTS idx_chat_logs_msg_type
  ON chat_logs (session_id, msg_type)
  WHERE msg_type = 'order';


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- เปิดใช้งาน RLS บนตารางใหม่ และอนุญาตเฉพาะ service role เท่านั้น
-- Enable RLS on new tables; only the service role bypass is allowed
-- =============================================================================

ALTER TABLE stats_timeline  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_logs       ENABLE ROW LEVEL SECURITY;

-- Policy: อนุญาตให้ service role อ่าน/เขียนทุกแถวใน stats_timeline
-- Allow full access only via the service role key
CREATE POLICY "service_role_all_stats_timeline"
  ON stats_timeline
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: อนุญาตให้ service role อ่าน/เขียนทุกแถวใน chat_logs
-- Allow full access only via the service role key
CREATE POLICY "service_role_all_chat_logs"
  ON chat_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- VIEW: session_peak_stats
-- มุมมองสรุป peak stats ของแต่ละเซสชันจาก stats_timeline
-- Helper view aggregating peak stats per session from stats_timeline
-- =============================================================================

CREATE OR REPLACE VIEW session_peak_stats AS
SELECT
  session_id,
  MAX(viewer_count)    AS peak_viewers,
  MAX(gmv_satang)      AS final_gmv_satang,
  MAX(units_sold)      AS final_units_sold,
  MIN(polled_at)       AS first_poll,
  MAX(polled_at)       AS last_poll,
  COUNT(*)             AS total_polls
FROM stats_timeline
GROUP BY session_id;

COMMENT ON VIEW session_peak_stats IS 'สรุป peak stats ต่อเซสชัน / Aggregated peak stats per session from stats_timeline';
