# LiveWatch — Feature List

> Last updated: 2026-04-09 (post-SaaS migration)

---

## MVP (Phase 1) — Screencap + LINE Alert
- [x] MutationObserver หา `<video>` element เมื่อ LIVE เริ่ม
- [x] Canvas frame capture — 3 frames ห่างกัน 5 วินาที
- [x] `chrome.alarms` trigger ทุก 8 นาที (configurable 6–15 min)
- [x] Auto-detect live tab on Chrome start (`runtime.onStartup`, `tabs.onUpdated`)
- [x] `scanTabs()` ตรวจสอบ video readyState ผ่าน CHECK_VIDEO message (ป้องกัน false-positive MONITORING)
- [x] ส่ง 3 frames ไป SaaS proxy `/api/ai/analyze` → Pollinations (gemini-flash-lite-3.1):
  - phone_detected, eye_contact_score (0-100), smile_score (0-100)
  - product_presenting, presenter_visible, activity_summary
  - alert_required + alert_reason
- [x] LINE Messaging API push notification ผ่าน SaaS proxy `/api/line/send`
- [x] Popup ON/OFF toggle + status display
- [x] Settings page: dynamic connection UI (สถานะเชื่อมต่อ / ปุ่มสมัคร), capture interval
- [x] chrome.storage.local log (rolling 200 entries)
- [x] `lastBurstAt` cleared on `endSession()` (ป้องกัน burst suppression ข้าม session)

## Phase 2 — Chat Extraction
- [x] MutationObserver บน chat feed (multi-selector fallback: 10 selectors)
- [x] WebSocket intercept (injected.js ผ่าน `world: MAIN`) — handles binary frames via UTF-8 decode
- [x] Chat log: {ts, user, text, type} — เก็บใน `chatBuffer` ring buffer
- [x] Chat node extraction with expanded username/text selectors (9+ selectors each)
- [x] Chat tab "คำสั่งซื้อ" — ดึง orders ที่เกิดระหว่างไลฟ์ (msg_type='order' detection via regex)
- [x] Batch chat sentiment analysis ทุก 10 นาที (SaaS proxy `/api/ai/chat`):
  - sentiment score, top questions, top complaints
  - purchase intent signals, suggested action

## Phase 3 — Real-time Stats
- [x] Poll `/api/v1/streamer_desktop/live_room_info/get` ทุก 30s
  - viewer_count, like_count, room status (2=live, 4=ended)
- [x] Poll `/api/v1/streamer_desktop/home/info` ทุก 30s
  - GMV, units_sold, product_clicks, CTR
- [x] Poll `#guide-step-2` DOM fallback — multi-selector (9+ card selectors), expanded Thai label patterns
  - fix: removed over-broad "ดู" from viewer pattern (was matching avg-watch-time label)
  - fix: removed over-broad "ยอด" from GMV pattern (was matching ยอดคลิกสินค้า = product clicks)
  - fix: added "ยอดคลิก|คลิกสินค้า" to clicks pattern; "แตะผ่าน|อัตราการแตะ" to CTR pattern
- [x] Stats timeline log ต่อ session (`statsBuffer` in chrome.storage.local)
- [x] Live stats display in popup (viewers, GMV, units sold, likes, clicks, CTR)

## Phase 4 — Session Summary
- [x] ตรวจจับ LIVE จบ (room status = 4) — via stats poll + LIVE_ENDED message (double-finalize guard)
- [x] Aggregate session: ชั่วโมงไลฟ์, GMV, ยอดขาย, viewer peak
- [x] สรุป AI analysis ทั้งหมด (phone alerts, smile avg, chat sentiment) จาก `statsBuffer` + `recentCaptures`
- [x] ส่ง LINE summary report ตอนจบไลฟ์

## Wave 3 — CMO Red-flags Report
- [x] `cmoRedFlags` alarm — fires every Monday 10:00 Asia/Bangkok (1 h after weeklyRollup, same Monday-DOW guard + re-anchor on drift)
- [x] `src/reports/cmo_redflags.js` — `buildCmoRedFlags()` + `sendCmoRedFlagsToLine()`:
  - Reads `execReports` from `chrome.storage.local`; graceful "no data" fallback (< 7 days)
  - **🔴 Flag 1** — High-impression / no-sale SKUs: aggregates `bottomSkus`, flags where impressions ≥ 5000 AND GMV = 0; top 5 offenders
  - **🔴 Flag 2** — Missed golden time slots: derives best hourBucket from last 30 days (min 2 sessions guard), lists days in last 7 with no live in that bucket
  - **🔴 Flag 3** — ROAS decline: this-week avg vs prev-4-weeks avg; skipped gracefully if all `adSpend = null`; requires ≥ 5 sessions total; flags if drop ≥ 25%
  - **🟡 Flag 4** — Presenter absence spikes: sessions where `presenterAbsentCount ≥ 3`
  - **🟡 Flag 5** — Quiet-minute spikes: sessions where `quietMinutes ≥ 10`
  - **🟢 Positive signals** — Best session by GMV; most improved SKU (vs previous 7 days, new SKUs labeled "ใหม่สัปดาห์นี้")
  - SKU deduplication normalized (lowercase + trim) to avoid double-counting
  - No-flag case sends green-only message

## Wave 2 — Executive Rollup Reports
- [x] `weeklyRollup` alarm — fires every Monday 09:00 Asia/Bangkok (idempotent, re-anchored on SW restart)
- [x] `monthlyRollup` alarm — fires on 1st of month 09:00 Asia/Bangkok (approximate period, re-anchored)
- [x] `src/reports/weekly_rollup.js` — `buildWeeklyRollup()` + `sendWeeklyRollupToLine()`:
  - 7-day window from `execReports` (with graceful "no data" fallback)
  - สรุปสัปดาห์: GMV รวม, ยอดขาย, จำนวนไลฟ์, ชั่วโมงรวม
  - Top 3 sessions by GMV, Top 5 SKUs (aggregated), Top 3 traffic channels (avg %)
  - Trend vs previous 7 days: GMV ±%, sessions ±%, avg GMV/session ±%
  - Best time-of-day slot (4 buckets: 00-06, 06-12, 12-18, 18-24)
- [x] `src/reports/monthly_rollup.js` — `buildMonthlyRollup()` + `sendMonthlyRollupToLine()`:
  - 30-day window from `execReports` (with graceful "no data" fallback)
  - Top 10 SKUs (aggregated GMV), per-weekday avg GMV table
- [x] `execReports` storage key — compact per-session records appended in `finalizeSession()`:
  - sessionId, date, startTs, endTs, durationMin, gmv, units, viewers, impressions, adSpend
  - topSkus (top 5), bottomSkus (bottom 3), trafficMix (up to 11), quietMinutes, presenterAbsentCount, avgSentiment, productCount, hourBucket (0–3)
  - Cap enforced at 180 entries (≈ 6 months)
- [x] `minutesUntilBangkokTime()` — timezone-correct Bangkok delay calculator (UTC+7 explicit, no system TZ)
- [x] Monthly rollup guard: re-anchors alarm if off-day fire detected

## Wave 1 — Executive / Management Reporting
- [x] `WORKBENCH_STATS_UPDATE` + `WORKBENCH_HEARTBEAT` handlers ใน background.js — merge payload เข้า `workbenchStats`, อัป `lastWorkbenchHeartbeat`
- [x] `content_workbench.js` registered ใน manifest.json สำหรับ `shop.tiktok.com/workbench/live/*`
- [x] `gmvSnapshot` alarm ทุก 1 นาที (active เฉพาะ MONITORING/CAPTURING) — ring buffer 720 entries (12 ชั่วโมง) ใน `gmvTimeline`
- [x] Reset `gmvTimeline` เมื่อ LIVE_STARTED ใหม่
- [x] Clear `gmvSnapshot` alarm เมื่อ `goOffline()`
- [x] `buildSessionSummary()` enriched:
  - Top 3 / Bottom 3 SKUs จาก `workbenchStats.products` (by GMV)
  - Traffic mix: top 3 channels (name + GMV%)
  - จุดเงียบ: นับ quiet minutes จาก `gmvTimeline` (5-min zero-delta window)
  - ช่วงไม่มีพิธีกร: count จาก `recentCaptures` ที่ `presenter_visible === false`
  - มูลค่าเฉลี่ยต่อออเดอร์ (avg order value)
  - เทียบ 7d/30d avg GMV จาก `sessionHistory`
- [x] `finalizeSession()` append session entry ไปยัง `sessionHistory` (cap 60) ก่อนส่ง summary
- [x] LINE executive summary section (Thai): ยอดรวม, Top/Bottom SKUs, traffic mix, จุดเงียบ, ช่วงไม่มีพิธีกร, เทียบค่าเฉลี่ย
- [x] Backward compat — ทุก executive section skip gracefully เมื่อ `workbenchStats` ว่าง

## Phase 5 — Web Dashboard (SaaS)
- [x] Next.js 15 + Tailwind v4 + Supabase Auth
- [x] Landing page + Privacy + Terms
- [x] Bilingual UI (ไทย/English) — LocaleProvider + LanguageSwitcher
- [x] Separate auth pages: login + signup (พร้อม `?extId=` capture)
- [x] Auth-aware Navbar (แสดง logout เมื่อ login แล้ว, login/signup เมื่อยัง)
- [x] Dashboard: 4-step onboarding checklist (Install → Pair LINE → Generate Token → Connect)
- [x] Dashboard: LINE pairing section (QR code + pairing code)
- [x] Dashboard: Token management (generate / list / revoke)
- [x] Dashboard: Plan card (tier display)
- [x] Dashboard: LINE unpair button + connection status check (`/api/pairing/status`, `/api/pairing/unpair`)
- [x] Auto-paste token flow: dashboard ส่ง token กลับ extension ผ่าน `chrome.runtime.sendMessage`
- [x] Session history list page (`/sessions`) — client component, shows all past sessions with date, duration, burst count, alert count badge, link to detail
- [x] Session detail page (`/sessions/[id]`) — analysis gallery with thumbnails, eye contact/smile scores (color-coded), phone/alert/product badges, activity summary
- [x] Dashboard recent sessions widget — last 3 sessions with "View all" link
- [x] Sessions nav link added to Navbar
- [ ] Gallery ภาพ captures ตามเวลา (timeline view)
- [ ] Alert log พร้อม thumbnail
- [ ] Stats chart: viewer/GMV ตลอดไลฟ์
- [ ] Chat log viewer + sentiment badges
- [ ] Multi-room support (ถ้า owner มีหลาย account)

## SaaS Backend API (`saas/app/api/`)
- [x] `POST /api/ai/analyze` — Vision AI proxy (Pollinations), tier rate-limit enforcement
- [x] `POST /api/ai/chat` — Chat sentiment AI proxy
- [x] `POST /api/line/send` — LINE push notification proxy (requires LINE pairing)
- [x] `POST /api/line/webhook` — LINE webhook receiver (pairing code matching, messages)
- [x] `GET  /api/pairing/status` — ดึง pairing code + LINE paired status (token + cookie auth)
- [x] `POST /api/pairing/regenerate` — สร้าง pairing code ใหม่ + สร้าง public.users row
- [x] `POST /api/pairing/unpair` — ล้าง line_user_id + paired_at (token + cookie auth)
- [x] `POST /api/tokens/generate` — สร้าง API token (`lw_*` prefix, SHA-256 hash)
- [x] `GET  /api/tokens/list` — ดู tokens ที่มีอยู่
- [x] `POST /api/tokens/revoke` — ยกเลิก token
- [x] `GET  /api/user/tier` — ดึง tier ของ user (free/pro/enterprise)

## Google Sheets / Drive Integration
- [x] `chrome.identity.getAuthToken` OAuth — เชื่อมต่อ Google account ใน Settings
- [x] เขียนข้อมูลลง Google Sheets (analysis_logs, sessions, stats_timeline, chat_logs)
- [x] อัปโหลดรูปไปยัง Google Drive folder `LiveWatch/frames/` (public link)
- [x] สร้าง Spreadsheet ใหม่อัตโนมัติจาก Settings page

## Phase 6 — Analytics Scraper
- [x] ดึงข้อมูลจากหน้า Analytics (`/streamer/compass/livestream-analytics/view`)
  - KPI trends: GMV, views, followers, likes, comments
  - Per-session breakdown, historical table (`#live-details-anchor`)
- [x] Auto-scrape หลังจบไลฟ์แต่ละครั้ง (opens tab, scrapes, stores in analyticsHistory)

## Extension Auth & Tier System
- [x] `src/tier.js` — อ่าน `userTier` จาก chrome.storage.local, `effectiveCaptureInterval()` clamp ตาม tier
- [x] Token auth: `apiToken` (`lw_*`) เก็บใน `chrome.storage.local.config`
- [x] Authorization header `Bearer <token>` ส่งทุก SaaS API call
- [x] Settings page: dynamic connection UI — แสดงสถานะ tier + ปุ่ม unpair/manage
- [x] i18n: `src/i18n.js` + `data-i18n` attributes (ไทย default, toggle ไทย/EN)
