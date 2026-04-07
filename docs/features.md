# LiveWatch — Feature List

## MVP (Phase 1) — Screencap + LINE Alert
- [x] MutationObserver หา `<video>` element เมื่อ LIVE เริ่ม
- [x] Canvas frame capture — 3 frames ห่างกัน 5 วินาที
- [x] `chrome.alarms` trigger ทุก 8 นาที
- [x] Auto-detect live tab on Chrome start (`runtime.onStartup`, `tabs.onUpdated`)
- [x] ส่ง 3 frames ไป Pollinations API (gemini-flash-lite-3.1) วิเคราะห์:
  - phone_detected + phone_likelihood (0-100)
  - eye_contact_score (0-100) + confidence
  - smile_score (0-100) + confidence
  - product_presenting + confidence
  - presenter_visible + face_visible + head_pose + eyes_open
  - observed_details + activity_summary (ภาษาไทย, CoT)
  - alert_required + alert_reason
- [x] Prompt บังคับ chain-of-thought + กฎ post-processing ฝั่ง JS
  (ก้มหน้า/ตาปิด → eye_contact ≤15, looking_down → phone_likelihood ≥60)
- [x] LINE Messaging API push notification เมื่อ alert_required = true
- [x] Popup ON/OFF toggle + status display
- [x] Settings page: LINE token, LINE user ID, capture interval
- [x] chrome.storage.local log (rolling 200 entries)

## Phase 2 — Chat Extraction
- [x] MutationObserver บน `#dashboard-guide-chat .overflow-y-hidden` ดัก messages
- [x] WebSocket intercept (injected.js ผ่าน `world: MAIN`, `run_at: document_start`)
- [x] Chat log: {ts, user, text, type} — เก็บใน `chat_logs` table + `chatBuffer` ring buffer
- [ ] Chat tab "คำสั่งซื้อ" — ดึง orders ที่เกิดระหว่างไลฟ์ (msg_type='order' schema ready)
- [x] Batch chat sentiment analysis ทุก 10 นาที (Pollinations openai-fast):
  - sentiment score
  - top questions
  - top complaints
  - purchase intent signals
  - suggested action

## Phase 3 — Real-time Stats
- [x] Poll `/api/v1/streamer_desktop/live_room_info/get` ทุก 30s
  - viewer_count, like_count, room status (2=live, 4=ended)
- [x] Poll `/api/v1/streamer_desktop/home/info` ทุก 30s
  - GMV, units_sold, product_clicks, CTR
- [x] Poll `#guide-step-2 [class*="metricCard"]` DOM fallback (Thai label text matching)
- [x] Stats timeline log ต่อ session (`stats_timeline` table)

## Phase 4 — Session Summary
- [x] ตรวจจับ LIVE จบ (room status = 4) — via stats poll + LIVE_ENDED message (double-finalize guard)
- [x] Aggregate session: ชั่วโมงไลฟ์, GMV, ยอดขาย, viewer peak
- [x] สรุป AI analysis ทั้งหมด (phone alerts, smile avg, chat sentiment)
- [x] ส่ง LINE summary report ตอนจบไลฟ์

## Phase 5 — Web Dashboard
- [x] Gallery ภาพ captures ตามเวลา (timeline view) — `dashboard/`
- [x] Alert log พร้อม thumbnail
- [x] Stats chart: viewer/GMV ตลอดไลฟ์ (Chart.js)
- [x] Chat log viewer + sentiment badges
- [x] Session history (ดูย้อนหลังได้)
- [ ] Multi-room support (ถ้า owner มีหลาย account)

## Google Sheets / Drive Integration (เพิ่มเติม)
- [x] `chrome.identity.getAuthToken` OAuth — เชื่อมต่อ Google account ใน Settings
- [x] เขียนข้อมูลลง Google Sheets แทน/เพิ่มจาก Supabase (dual-write)
  - analysis_logs, sessions, stats_timeline, chat_logs
- [x] อัปโหลดรูปไปยัง Google Drive folder `LiveWatch/frames/` (public link)
  - Supabase Storage = primary, Drive = fallback (Promise.allSettled parallel upload)
- [x] สร้าง Spreadsheet ใหม่อัตโนมัติจาก Settings page

## Phase 6 — Analytics Scraper (Bonus)
- [ ] ดึงข้อมูลจากหน้า Analytics (`/streamer/compass/livestream-analytics/view`)
  - KPI trends: GMV, views, followers, likes, comments
  - Per-session breakdown
  - Historical table (`#live-details-anchor`)
- [ ] Auto-scrape หลังจบไลฟ์แต่ละครั้ง
