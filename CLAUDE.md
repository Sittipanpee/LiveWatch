# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LiveWatch Extension** — a Chrome Extension (Manifest V3) that monitors TikTok Shop live streaming sessions for Thai sellers. It captures video frames every 8 minutes, analyzes presenter behavior via AI vision, and sends real-time alerts via LINE messaging.

## No Build Tooling

This is **vanilla JavaScript with no build step**. There is no npm, no bundler, no transpilation. Load directly into Chrome:

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. "Load unpacked" → select this directory

There are no test commands. Use the in-extension test buttons (Settings page has connectivity tests; Popup has a manual capture burst button). All logs are prefixed `[LiveWatch]` in the browser console.

## Architecture

```
background.js (Service Worker, type: module)
    ↕ chrome.runtime.sendMessage
content.js (injected into shop.tiktok.com/streamer/live/*)
    ↕ chrome.storage.local (polling every 2s)
popup/popup.js
settings/settings.js
```

**`src/background.js`** — the main engine (~1135 lines). Owns a state machine (`OFFLINE → MONITORING → CAPTURING → ANALYZING → MONITORING`), manages chrome.alarms, and orchestrates all external API calls.

**`src/content.js`** — injected into TikTok live pages. Uses MutationObserver to detect the `<video>` element, sends `LIVE_STARTED`/`LIVE_ENDED`/`HEARTBEAT` messages to background, and performs `performCaptureBurst()` (3 JPEG frames, 5s apart, canvas.toDataURL at quality 0.6).

**`src/ai.js`** — Pollinations vision API wrapper (OpenAI-compatible). Sends frames as base64 images to `gemini-flash-lite-3.1`, returns structured JSON scores.

**`src/line.js`** — LINE Messaging API push notifications. All message formatting is in Thai.

**`src/supabase.js`** — thin REST wrapper (no SDK; MV3 forbids external npm packages). Returns `{ data, error }` shape.

**`src/constants.js`** — shared constants used across modules. Content scripts cannot use ES6 imports, so any constants needed there must be inlined.

## Key Constraint: ES6 Modules

Only `background.js` (declared `type: module` in manifest) can use `import`. Content scripts (`content.js`) run in a different context and **cannot import**. Any constants or utilities needed in content scripts must be duplicated inline — do not add import statements to `content.js`.

## Alarm Schedule

| Alarm | Interval | Action |
|-------|----------|--------|
| `captureBurst` | 8 min (configurable 6–15) | Triggers frame capture → AI analysis → Supabase insert → LINE alert |
| `dailySummary` | Daily at 23:00 (configurable) | Aggregates analysis_logs, sends LINE summary |
| `hourlySummary` | Every 60 min | Sends recent captures report to LINE |
| `scanTabs` | Every 2 min | Detects new live tabs |

## External APIs

| Service | Purpose | Config Key |
|---------|---------|------------|
| Pollinations (`gen.pollinations.ai`) | Vision AI analysis | `pollinationsKey` |
| LINE Messaging API | Push notifications | `lineToken`, `lineUserId` |
| Supabase REST | Database + frame storage | `supabaseUrl`, `supabaseKey` |

All credentials are stored in `chrome.storage.local` under the `config` key. **Supabase RLS is set to service_role only** — the anon key stored in the extension must be the service_role key for writes to succeed.

## Database Schema

Three Supabase tables (see `supabase/schema.sql`):
- **`sessions`** — one row per live session
- **`analysis_logs`** — one row per capture burst (8-min interval); stores AI scores and thumbnail URL
- **`daily_summaries`** — one row per calendar date

Storage bucket: `livewatch-frames`, path pattern: `frames/{date}/{sessionId}/{timestamp}.jpg`

## State Stored in chrome.storage.local

| Key | Contents |
|-----|----------|
| `config` | API credentials + timing settings |
| `extensionState` | `{ status, liveTabId, sessionId, lastHeartbeat }` |
| `lastAnalysis` | Most recent AI analysis JSON |
| `lastFrame` | Base64 thumbnail of last captured frame |
| `todayStats` | Aggregated daily metrics |
| `recentCaptures` | Ring buffer, last 20 captures |
| `localLogs` | Rolling 200-entry log |

## Capture Pipeline (Critical Path)

```
chrome.alarms('captureBurst')
  → background.triggerBurst()
  → content.performCaptureBurst()   [3 frames, 5s apart]
  → background.analyzeFrames()      [Pollinations API]
  → uploadThumbnail()               [Supabase Storage]
  → supabaseInsert('analysis_logs')
  → sendCaptureAlert()              [LINE API]
  → popup polls storage every 2s   [UI updates]
```

## Alert Logic

- Phone alert triggers if `phone_detected` in 2+ frames OR `eye_contact_score < 20`
- All alerts sent immediately per burst (not batched)
- LINE messages include thumbnail only if Supabase is configured

## Workflow Rule

**Before marking any task complete, update `docs/features.md`:**
- Check off `- [x]` any items that are now fully implemented
- Add new items under the appropriate phase if scope expanded
- This must happen before the final response to the user — not as an afterthought

---

## ⚠️ Outstanding Manual Tasks (Check at Start of Every Session)

**At the start of every session, scan this section. For each unchecked item, REMIND the user politely (one short sentence each). When the user confirms an item is done, DELETE it from this list and commit the CLAUDE.md update.**

### 🟡 Pending — Awaiting User Action

- [ ] **Schedule `cleanup-frames` Edge Function cron in Supabase Dashboard**
  - URL: https://supabase.com/dashboard/project/sfgccfrwwfuhcehcngza/integrations/cron/overview
  - Edge function `cleanup-frames` is already deployed and tested working
  - Need: enable `pg_cron` extension → create cron job (`0 3 * * *`, type=Edge Function, function=cleanup-frames, method=POST)
  - Alternative: SQL `select cron.schedule('cleanup-frames-daily', '0 3 * * *', $$ select net.http_post(...) $$);`

- [ ] **Rotate `POLLINATIONS_API_KEY`** (key was pasted in chat history)
  - Go to https://enter.pollinations.ai → revoke current key → generate new
  - Update Vercel: `vercel env rm POLLINATIONS_API_KEY production --yes && vercel env add POLLINATIONS_API_KEY production`
  - Then `vercel --prod --yes` to redeploy

- [ ] **Rotate `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_ACCESS_TOKEN`** (also pasted in chat history)
  - LINE Developer Console → Messaging API → reissue secret + token
  - Update Vercel env vars (same pattern)

- [ ] **Rotate Supabase service_role + anon JWT keys** (pasted in chat history)
  - Supabase Dashboard → Settings → API → roll keys
  - Update Vercel env vars + redeploy

- [ ] **Add Chrome Web Store `key` field to `manifest.json`** (after first publish)
  - Without this, unpacked dev installs get random IDs and `chrome.identity.getAuthToken` breaks
  - Extract from the `.crx` after first Web Store upload → add to manifest.json
  - See `docs/oauth-setup.md` for instructions

- [ ] **Decision: upload all 3 frames per burst to user's Drive (currently only frame[0] thumbnail)**
  - Trade-off: 3x Drive quota usage vs richer history
  - User must decide → tell Claude which path; can spawn Frontend agent to expand

- [ ] **Decision: clean up dead Supabase code paths in `src/background.js`**
  - `uploadThumbnail`, `sendDailySummary`, etc. still reference `supabaseUrl`/`supabaseKey` from config (which are now always empty since the settings UI removed those fields). Calls become inert no-ops. Functional but adds clutter. Leaving for safety/rollback.

### 📦 Architecture (post-SaaS migration)

The extension is now a **SaaS client**. Key changes from original architecture:

- **No more user-provided API keys**: LINE, Pollinations, and Supabase are all proxied through the SaaS backend at `https://livewatch-psi.vercel.app`
- **Authentication**: extension stores `apiToken` (lw_*) in `chrome.storage.local.config`. Authentication via `Authorization: Bearer` header to all backend endpoints.
- **Auto-paste flow**: extension opens SaaS with `?extId=<chrome.runtime.id>`, dashboard sends token back via `chrome.runtime.sendMessage` → `onMessageExternal` listener (whitelisted via `externally_connectable` in manifest.json)
- **Tier enforcement**: `src/tier.js` reads `chrome.storage.local.userTier`, `effectiveCaptureInterval()` clamps user setting to tier minimum. Backend also enforces via `/api/ai/analyze` rate limit.
- **i18n**: `src/i18n.js` ES module + `data-i18n="group.key"` attributes in popup/settings/onboarding HTML. Default `th`, toggle to `en`.

### 🌐 SaaS Companion App (under `saas/`)

Next.js 15 + Tailwind v4 + Supabase Auth + bilingual i18n. Key files:
- `app/api/{ai/analyze, line/{webhook,send}, pairing/{regenerate,status}, tokens/{generate,list,revoke}, user/tier}` — backend API routes
- `app/(auth)/{login,signup}/page.tsx` — separate auth pages with `?extId=` capture
- `app/(dash)/dashboard/{page,OnboardingChecklist,PairingSection,TokensSection,PlanCard}.tsx` — guided dashboard with 4-step checklist
- `components/ui/*` — Button, Card, Input, Badge, Alert, StepCard built on Tailwind + cva
- `components/{LocaleProvider,LanguageSwitcher,Navbar}.tsx` — i18n context + UI shell
- `lib/{i18n,utils,tiers,tokens,auth,pairing,ai,line/*,supabase/*}.ts` — typed helpers

Vercel project: `sittipanpees-projects/livewatch` → https://livewatch-psi.vercel.app
Repo root has `.vercel/` link; `Root Directory` is set to `saas` in Vercel project settings, so deploy from repo root with `vercel --prod --yes`.

### 🔒 Required Vercel Env Vars

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
NEXT_PUBLIC_APP_URL
POLLINATIONS_API_KEY
```
