# LiveWatch SaaS

Next.js 15 (App Router) backend for the LiveWatch Chrome extension. Handles
auth, LINE account pairing, and server-to-server LINE push on behalf of the
extension.

## Overview

- **Auth**: Supabase Auth (email + password).
- **LINE pairing**: user generates a short-lived code on the dashboard, sends
  it to the LiveWatch LINE bot, webhook atomically claims the code and stores
  the LINE `userId` against the user row.
- **LINE send**: `/api/line/send` is an S2S endpoint (shared-secret header)
  for the extension backend to push alerts by Supabase user id.
- **Retention**: frame cleanup runs via a Supabase Edge Function (see
  `supabase/functions/cleanup-frames/`).

## Setup

### 1. Env vars

Copy `.env.example` → `.env.local` and fill in:

| Var | Where from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings — **server-only** |
| `LINE_CHANNEL_SECRET` | LINE Developers → channel → Basic settings |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → channel → Messaging API |
| `NEXT_PUBLIC_APP_URL` | e.g. `https://app.livewatch.example` |

### 2. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply migrations (see below).
3. Deploy the cleanup Edge Function.
4. Copy URL + anon key + service-role key into env.

### 3. LINE bot

1. Create a Messaging API channel at
   [developers.line.biz](https://developers.line.biz/).
2. Disable auto-reply, enable webhooks.
3. Set webhook URL to `https://<your-app>/api/line/webhook`.
4. Copy channel secret + access token into env.

### 4. Run locally

```bash
# Installing deps is left to the operator — no lockfile is committed yet.
npm install
npm run dev
```

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Import into Vercel, root directory = `saas/`.
3. Add all env vars from `.env.example`.
4. Deploy. Set the LINE webhook URL to the production URL.

## Migrations

SQL migrations live under `../supabase/migrations/`. Apply via the Supabase
SQL editor or the CLI:

```bash
supabase db push
```

Files:
- `20260408_users.sql` — `users` table + RLS policies.
- `20260408_retention.sql` — reference / documentation for the cleanup schedule.

## Edge Function deploy

```bash
supabase functions deploy cleanup-frames
# Then schedule it from Dashboard → Edge Functions → cleanup-frames → Schedules
# (daily at 03:00 UTC recommended).
```

## Chrome OAuth client

See `../docs/oauth-setup.md` (parent repo) for configuring the Chrome Web Store
OAuth client used by the extension to authenticate against this backend.

## Subscription Tiers

| Tier     | Max Captures / Hour | Min Interval |
|----------|---------------------|--------------|
| Gold     | 3                   | 20 minutes   |
| Platinum | 6                   | 10 minutes   |
| Diamond  | 12                  | 5 minutes    |

The extension polls `GET /api/user/tier` on startup and every 6 hours, caching the result in `chrome.storage.local`. The extension enforces `minIntervalMinutes` as a floor on the user's configured capture interval.

## Legal pages

Public, server-rendered pages (no auth) linked from the global footer:

- `/privacy` — Privacy Policy (Thailand PDPA-compliant, bilingual Thai + English)
- `/terms` — Terms of Service (bilingual; includes explicit clause that users are
  responsible for complying with the platform ToS of any live commerce platform
  they monitor — this protects LiveWatch from Chrome Web Store rejection)

Note: Before submitting the Chrome extension to the Web Store, replace the
`support@livewatch.app` placeholder with your real contact email in both
`app/privacy/page.tsx` and `app/terms/page.tsx`.

## Extension Integration

The Chrome extension connects to this SaaS via API tokens. Flow:

1. Extension opens `/login?extId=<chrome.runtime.id>`
2. User signs up / logs in — extId persists via sessionStorage across redirect
3. Dashboard "Chrome Extension Connection" section lets user generate a token
4. "Send to Extension" button auto-configures the extension via
   `chrome.runtime.sendMessage(extId, { type: 'SET_API_TOKEN', token, apiBase })`
5. Extension receives the token, validates sender origin, stores in chrome.storage.local
6. Manual copy-paste remains as fallback for non-Chrome browsers

## AI proxy

`POST /api/ai/analyze` — extension sends base64 frames with Bearer token,
backend forwards to Pollinations using the server-side `POLLINATIONS_API_KEY`.

Rate limit: per user tier (gold 3/hr, platinum 6/hr, diamond 12/hr) tracked
in `public.ai_analysis_logs` table.

### Setup

```
vercel env add POLLINATIONS_API_KEY production
# paste your Pollinations API key (starts with sk_)
```
