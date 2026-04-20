# Developer Onboarding — LiveWatch Extension

เปิดโปรเจกต์มาครั้งแรก อ่านไฟล์ตามลำดับนี้:

---

## 1. `CLAUDE.md` (รากโปรเจกต์)
อ่านก่อนเสมอ — มี architecture overview, key constraints (no build step, ES6 module limit ใน content.js), alarm schedule, external APIs, SaaS migration notes และ **Outstanding Manual Tasks** (งานที่ต้องทำใน Supabase/Vercel/LINE Console)

## 2. `manifest.json` — Chrome Extension Entry Point

```
manifest_version: 3      Chrome MV3 (Service Worker, ไม่ใช่ background page)
name/version              ชื่อ + เวอร์ชัน extension ที่แสดงใน Chrome Web Store

permissions:
  storage      → chrome.storage.local (เก็บ config, state, logs)
  alarms       → chrome.alarms (trigger capture ทุก 8 นาที, daily summary, scan tabs)
  tabs         → อ่านข้อมูล tab (URL, status) เพื่อหา TikTok live tab
  activeTab    → เข้าถึง tab ที่ active อยู่ตอนกด popup
  scripting    → inject content script แบบ programmatic (chrome.scripting.executeScript)
  identity     → chrome.identity.getAuthToken สำหรับ Google OAuth (Sheets/Drive)

host_permissions:
  shop.tiktok.com/*      → content script + fetch ไป TikTok API
  api.line.me/*          → LINE direct fallback (ปกติผ่าน SaaS proxy แล้ว)
  *.supabase.co/*        → Supabase REST (legacy, ปัจจุบัน SaaS proxy)
  sheets.googleapis.com  → Google Sheets write
  www.googleapis.com     → Google Drive upload
  accounts.google.com    → Google OAuth token endpoint

background.service_worker: "src/background.js" (type: module)
  → Service Worker หลัก ทำงาน event-driven, unloads เมื่อ idle

content_scripts[0]: src/injected.js
  matches: shop.tiktok.com/streamer/live/*
  run_at: document_start, world: MAIN
  → inject ก่อน page scripts โหลด, intercept WebSocket สำหรับ chat

content_scripts[1]: src/content.js
  matches: shop.tiktok.com/streamer/live/*
  run_at: document_idle
  → inject หลัง DOM พร้อม, handle video detection + frame capture

action.default_popup: popup/popup.html
  → กด icon extension ใน toolbar เปิด popup

options_page: settings/settings.html
  → หน้า Settings (เปิดจาก right-click icon → Options)

externally_connectable:
  livewatch-psi.vercel.app, *.vercel.app, localhost:3000
  → อนุญาตให้ SaaS dashboard ส่ง chrome.runtime.sendMessage มาหา extension
  → ใช้ใน auto-paste token flow

oauth2:
  client_id: Google OAuth client (Google Cloud Console)
  scopes: spreadsheets + drive.file
  → ใช้กับ chrome.identity.getAuthToken สำหรับ Sheets/Drive integration
```

## 3. ไฟล์ Source หลัก (`src/`)

| ไฟล์ | บทบาท | อ่านเมื่อ |
|------|--------|-----------|
| `background.js` | State machine หลัก (~1200 บรรทัด): alarms, orchestration, API calls | แก้ capture flow, alert logic, session lifecycle |
| `content.js` | Inject ใน TikTok live page: video detection, frame capture, chat DOM | แก้ capture, chat extraction, false-positive detection |
| `injected.js` | WebSocket intercept (MAIN world): ดัก chat binary frames | แก้ chat intercept |
| `ai.js` | Pollinations vision API wrapper → `/api/ai/analyze` | แก้ AI analysis |
| `line.js` | LINE Messaging: SaaS proxy primary, direct fallback | แก้ LINE alerts |
| `stats.js` | Poll TikTok stats API + DOM fallback ทุก 30s | แก้ viewer/GMV stats |
| `chat.js` | Chat ring buffer + sentiment batch → `/api/ai/chat` | แก้ chat analysis |
| `session_summary.js` | สรุปตอนจบ session จาก statsBuffer + recentCaptures | แก้ session summary |
| `analytics.js` | Scrape Analytics page หลังจบ session | แก้ analytics scraper |
| `tier.js` | อ่าน userTier, clamp capture interval | แก้ tier enforcement |
| `i18n.js` | Bilingual strings (ไทย/EN), `data-i18n` attribute scanner | แก้ translations |
| `supabase.js` | Thin Supabase REST wrapper (legacy, mostly unused post-SaaS) | ดู schema shape |
| `sheets.js` | Google Sheets/Drive write | แก้ Sheets integration |
| `constants.js` | Shared constants (ต้อง inline ใน content.js ด้วย เพราะ import ไม่ได้) | เพิ่ม constants |

## 4. SaaS App (`saas/`)

| Path | บทบาท |
|------|--------|
| `saas/app/api/` | Backend API routes (AI proxy, LINE, pairing, tokens, tier) |
| `saas/lib/auth.ts` | Token auth: split 3-query approach (api_tokens → auth.admin → public.users) |
| `saas/lib/tiers.ts` | Tier definitions + rate limits |
| `saas/middleware.ts` | CORS for chrome-extension:// + Supabase auth cookie refresh |
| `saas/app/(dash)/dashboard/` | Dashboard UI components (onboarding checklist, pairing, tokens) |
| `saas/app/(auth)/` | Login + Signup pages |
| `saas/components/Navbar.tsx` | Auth-aware navbar (dynamic logout/login) |

Deploy: `vercel --prod --yes` จาก repo root (Vercel root dir = `saas/`)

## 5. `docs/features.md`
รายการฟีเจอร์ทั้งหมด พร้อม `[x]`/`[ ]` status — อัพเดทก่อน response สุดท้ายเสมอ

## 6. `supabase/schema.sql`
Schema ของ tables ทั้งหมด — อ่านเมื่อแก้ DB queries หรือเพิ่ม columns

---

## Key Constraints (จำไว้)

1. **content.js ใช้ `import` ไม่ได้** — constants ต้อง inline ทุกครั้ง
2. **SaaS proxy = primary path** — LINE/Pollinations/Supabase ทุกอย่างผ่าน `https://livewatch-psi.vercel.app`
3. **`public.users` row สร้างตอน LINE pairing เท่านั้น** — ไม่ใช่ตอน signup
4. **CORS headers ต้องเซ็ตหลัง Supabase auth refresh** ใน middleware (มิฉะนั้น response ถูก recreate ทับ)
5. **No build step** — load unpacked โดยตรงใน Chrome
