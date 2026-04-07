# LiveWatch — Architecture Diagrams

## Diagram 1: System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    เครื่องคอมพิวเตอร์พนักงาน                     │
│                                                                  │
│   Chrome Browser                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  "TikTok Shop Helper" Extension                          │  │
│   │                                                          │  │
│   │  content.js          background.js                       │  │
│   │  ┌─────────────┐     ┌─────────────────────────────┐    │  │
│   │  │ MutationObs │────►│ chrome.alarms (8 min)        │    │  │
│   │  │ Canvas cap  │◄────│ Tab tracker                  │    │  │
│   │  │ 3×frame     │     │ State machine                │    │  │
│   │  └─────────────┘     └──────────────┬──────────────┘    │  │
│   │         │                           │                    │  │
│   └─────────┼───────────────────────────┼────────────────────┘  │
│             │                           │                        │
│   Tab: shop.tiktok.com/streamer/live/*  │                        │
│   ┌─────────▼──────────┐               │                        │
│   │  XGPlayer <video>  │               │                        │
│   │  TikTok Live Feed  │               │                        │
│   └────────────────────┘               │                        │
└────────────────────────────────────────┼────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────┐
                    │          Pollinations API                │
                    │     model: gemini-flash-lite-3.1         │
                    │     input: 3 JPEG frames (base64)        │
                    │     output: JSON scores                  │
                    └────────────────────┬────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────┐
                    │              Supabase                    │
                    │  ┌──────────────┐  ┌─────────────────┐ │
                    │  │  PostgreSQL  │  │  Storage Bucket │ │
                    │  │  (metadata)  │  │  (thumbnails)   │ │
                    │  └──────────────┘  └─────────────────┘ │
                    └────────────┬──────────────┬────────────┘
                                 │              │
               ┌─────────────────▼──┐    ┌─────▼──────────────┐
               │   Web Dashboard    │    │    LINE Bot API      │
               │   (เจ้าของดูได้     │    │   สรุปรายวัน 23:00  │
               │    ทุกที่ทุกเวลา)   │    │   (daily summary)   │
               └────────────────────┘    └────────────────────┘
```

---

## Diagram 2: Capture Pipeline (ทุก 8 นาที)

```
chrome.alarms 'captureBurst'
        │
        ▼
background.js: triggerBurst()
  │  state: MONITORING → CAPTURING
  │
  └──► sendMessage(CAPTURE_BURST) ──► content.js
                                            │
                                      ┌─────▼──────────────────┐
                                      │  video = querySelector  │
                                      │        ('video')        │
                                      └─────┬──────────────────┘
                                            │
                                      t=0   ▼
                                      captureFrame() → frame_1 (JPEG base64)
                                            │
                                      wait 5s
                                            │
                                      t=5s  ▼
                                      captureFrame() → frame_2 (JPEG base64)
                                            │
                                      wait 5s
                                            │
                                      t=10s ▼
                                      captureFrame() → frame_3 (JPEG base64)
                                            │
                                      sendMessage(BURST_RESULT)
                                            │
        ┌───────────────────────────────────┘
        │
        ▼
background.js: analyzeWithGemini(frames)
        │
        │   POST https://text.pollinations.ai/openai
        │   model: gemini-flash-lite-3.1
        │   content: [prompt] + [img1] + [img2] + [img3]
        │
        ▼
  ┌─────────────────────────────────────────┐
  │ JSON Response:                          │
  │  phone_detected:        true/false      │
  │  eye_contact_score:     0-100           │
  │  smile_score:           0-100           │
  │  product_presenting:    true/false      │
  │  presenter_visible:     true/false      │
  │  activity_summary:      "string"        │
  │  alert_flag:            true/false      │
  └──────────────────┬──────────────────────┘
                     │
        ┌────────────▼─────────────┐
        │  Supabase INSERT         │
        │  analysis_logs table     │
        │  + upload thumbnail      │
        │    to Storage bucket     │
        └──────────────────────────┘
        
  (ไม่ LINE ทันที — รอสรุปรายวัน)
```

---

## Diagram 3: Daily Summary Flow (23:00 ทุกวัน)

```
chrome.alarms 'dailySummary' (fires at 23:00)
        │
        ▼
background.js: buildDailySummary()
        │
        │  Supabase query: SELECT * FROM analysis_logs
        │  WHERE date = TODAY
        │  + SELECT * FROM sessions WHERE date = TODAY
        │
        ▼
  ┌─────────────────────────────────────────────────────┐
  │  Aggregate:                                         │
  │  • total_live_minutes  = SUM(session durations)     │
  │  • total_bursts        = COUNT(analysis_logs)       │
  │  • alert_count         = COUNT(alert_flag = true)   │
  │  • avg_smile_score     = AVG(smile_score)           │
  │  • avg_eye_contact     = AVG(eye_contact_score)     │
  │  • phone_incidents     = COUNT(phone_detected=true) │
  │  • product_presenting% = AVG(product_presenting)    │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  LINE Messaging API: push message to owner
  ┌─────────────────────────────────────────┐
  │  📊 สรุปไลฟ์วันนี้ (6 เม.ย.)            │
  │                                         │
  │  ⏱ ไลฟ์ทั้งหมด:   3 ชั่วโมง 42 นาที    │
  │  😊 ยิ้มแย้มเฉลี่ย: 72/100              │
  │  👁 มองกล้องเฉลี่ย: 68/100              │
  │  📦 เสนอสินค้า:    84% ของเวลา          │
  │  📱 จับมือถือ:     2 ครั้ง              │
  │  ⚠️ รายงานผิดปกติ: 2 ครั้ง             │
  │                                         │
  │  ดูรายละเอียด: [link to dashboard]      │
  └─────────────────────────────────────────┘
                          │
                          ▼
        UPDATE daily_summaries
        SET sent_to_line = true
```

---

## Diagram 4: State Machine

```
                    Chrome เปิด
                         │
                         ▼
              ┌──────────────────────┐
              │        OFFLINE        │◄──────────────────┐
              │  (ไม่มี live tab)     │                   │
              └──────────┬───────────┘                   │
                         │                               │
              URL match detected                   tab ปิด /
              shop.tiktok.com/streamer/live/*      stream หยุด
                         │                               │
                         ▼                               │
              ┌──────────────────────┐                   │
              │      MONITORING      │◄──────────────┐   │
              │  (รอ alarm + video)   │               │   │
              └──────────┬───────────┘               │   │
                         │                           │   │
                   alarm fires                  analysis  │
                   + video exists               complete  │
                         │                           │   │
                         ▼                           │   │
              ┌──────────────────────┐               │   │
              │      CAPTURING       │               │   │
              │  (3 frames × 5s)     │               │   │
              └──────────┬───────────┘               │   │
                         │                           │   │
                   frames ready                      │   │
                         │                           │   │
                         ▼                           │   │
              ┌──────────────────────┐               │   │
              │      ANALYZING       │───────────────┘   │
              │  (Pollinations API)  │                   │
              └──────────────────────┘───────────────────┘
```

---

## Diagram 5: Supabase Schema

```sql
-- Session ต่อครั้งที่ไลฟ์
CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  duration_mins INT,
  tab_url      TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ผลวิเคราะห์แต่ละ burst (ทุก 8 นาที)
CREATE TABLE analysis_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID REFERENCES sessions(id),
  captured_at         TIMESTAMPTZ NOT NULL,
  phone_detected      BOOLEAN,
  eye_contact_score   INT,           -- 0-100
  smile_score         INT,           -- 0-100
  product_presenting  BOOLEAN,
  presenter_visible   BOOLEAN,
  activity_summary    TEXT,
  alert_flag          BOOLEAN DEFAULT false,
  thumbnail_url       TEXT,          -- Supabase Storage URL (small JPEG)
  raw_scores          JSONB,         -- full Gemini response
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- สรุปรายวัน (เพื่อ query ไว + LINE summary)
CREATE TABLE daily_summaries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date          DATE NOT NULL UNIQUE,
  total_live_mins       INT,
  total_bursts          INT,
  alert_count           INT,
  phone_incidents       INT,
  avg_smile_score       NUMERIC(4,1),
  avg_eye_contact_score NUMERIC(4,1),
  product_presenting_pct NUMERIC(4,1),
  line_sent_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Supabase Storage Bucket: 'livewatch-frames'
-- Path: {session_id}/{timestamp}/thumb.jpg
-- Size: ~5KB per thumbnail (200×356, JPEG 0.35)
-- Retention: 30 days (auto-delete via lifecycle rule)
```

---

## Diagram 6: Data Size Estimation

```
ต่อวัน (ไลฟ์ 8 ชั่วโมง, ทุก 8 นาที):

  Bursts/วัน       = 60 bursts
  Thumbnails        = 60 × 5KB  = 300KB/วัน  ← Supabase Storage
  analysis_logs     = 60 rows   = ~50KB/วัน  ← PostgreSQL
  daily_summaries   = 1 row     = ~1KB/วัน

  ต่อเดือน (30 วัน):
  Storage:    300KB × 30 = 9MB
  Database:   60 rows × 30 = 1,800 rows

  Supabase Free Tier:
  ✅ Database: 500MB  (ใช้ไป ~1MB/เดือน)
  ✅ Storage:  1GB    (ใช้ไป ~9MB/เดือน)
  ✅ ดีมากสำหรับ MVP
```
