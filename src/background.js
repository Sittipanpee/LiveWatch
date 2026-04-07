/**
 * background.js — TikTok Shop Helper (LiveWatch) MV3 Service Worker
 *
 * State machine:
 *   OFFLINE → MONITORING → CAPTURING → ANALYZING → MONITORING (loop)
 *            ↑                                    ↓
 *            └──────── any error ─────────────────┘
 */

'use strict';

import { scheduleStatsAlarm, clearStatsAlarm, handleStatsPoll } from './stats.js';
import {
  appendChatMessage,
  flushChatBuffer,
  scheduleChatBatchAlarm,
  clearChatBatchAlarm,
  runChatSentimentBatch,
} from './chat.js';
import { finalizeSession } from './session_summary.js';
import { getAuthToken, revokeAuthToken, sheetsAppend, getOrCreateDriveFolder, uploadFrameToDrive } from './sheets.js';
import { TIER_LIMITS, getCachedTier, refreshTierCache, effectiveCaptureInterval } from './tier.js';

// ─── Logger (debug logs suppressed in production) ────────────────────────────

const DEBUG = false;
const log = {
  info:  (...a) => { if (DEBUG) console.info(...a); },
  warn:  (...a) => { if (DEBUG) console.warn(...a); },
  error: (...a) => console.error(...a),
};

// ─── Constants ────────────────────────────────────────────────────────────────

// gen.pollinations.ai = new authenticated API (full model list, vision support)
// text.pollinations.ai = legacy free API (openai-fast text-only)
const POLLINATIONS_URL_NEW  = 'https://gen.pollinations.ai/v1/chat/completions';
const POLLINATIONS_URL_FREE = 'https://text.pollinations.ai/openai';
const POLLINATIONS_MODEL    = 'gemini-flash-lite-3.1'; // vision + JSON, requires key
const POLLINATIONS_MODEL_FREE = 'openai-fast';         // fallback, text-only
const TIKTOK_LIVE_PATTERN = /shop\.tiktok\.com\/streamer\/live/;
const CAPTURE_INTERVAL_MINUTES = 8;
const FRAMES_PER_BURST = 3;
const FRAME_GAP_MS = 5000;
const ALARM_CAPTURE = 'captureBurst';
const ALARM_DAILY   = 'dailySummary';
const ALARM_HOURLY  = 'hourlySummary';
const ALARM_SCAN    = 'scanTabs';
const ALARM_REFRESH_TIER = 'refreshTier';
const DAILY_SUMMARY_HOUR   = 23;
const HOURLY_REPORT_PERIOD = 60;    // minutes
const MAX_RECENT_CAPTURES  = 20;    // keep last 20 in storage

const STATUS = {
  OFFLINE: 'OFFLINE',
  MONITORING: 'MONITORING',
  CAPTURING: 'CAPTURING',
  ANALYZING: 'ANALYZING',
};

const MSG = {
  LIVE_STARTED: 'LIVE_STARTED',
  LIVE_ENDED: 'LIVE_ENDED',
  HEARTBEAT: 'HEARTBEAT',
  CAPTURE_BURST: 'CAPTURE_BURST',
  GET_STATUS: 'GET_STATUS',
  TEST_BURST: 'TEST_BURST',
};

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  status: STATUS.OFFLINE,
  liveTabId: null,
  sessionId: null,
  lastHeartbeat: 0,
};

async function saveState() {
  try {
    await chrome.storage.local.set({ extensionState: state });
  } catch (e) {
    log.error('[LiveWatch] saveState failed:', e);
  }
}

async function loadState() {
  try {
    const { extensionState } = await chrome.storage.local.get('extensionState');
    if (extensionState) {
      state = { ...state, ...extensionState };
    }
  } catch (e) {
    log.error('[LiveWatch] loadState failed:', e);
  }
}

// ─── Thumbnail upload (Supabase Storage + Google Drive in parallel) ───────────

/**
 * Upload a frame thumbnail to Supabase Storage and/or Google Drive,
 * depending on which backends are configured. Both uploads run in parallel
 * and never block the capture pipeline.
 *
 * Returns the Supabase public URL if available, falls back to Drive webViewLink.
 *
 * @param {string} base64Jpeg
 * @param {string} sessionId
 * @param {string} capturedAt - ISO timestamp
 * @returns {Promise<string|null>}
 */
async function uploadThumbnail(base64Jpeg, sessionId, capturedAt) {
  try {
    const date     = capturedAt.substring(0, 10);
    const time     = capturedAt.substring(11, 19).replace(/:/g, '-');
    const filename = `${sessionId ?? 'nosession'}_${date}_${time}.jpg`;
    const storagePath = `frames/${date}/${sessionId ?? 'nosession'}/${time}.jpg`;

    const { supabaseUrl, supabaseKey, config = {} } =
      await chrome.storage.local.get(['supabaseUrl', 'supabaseKey', 'config']);

    const sheetsEnabled = !!(config.sheetsConnected && config.sheetsId);
    const supabaseEnabled = !!(supabaseUrl && supabaseKey);

    // ── Supabase upload (async, returns URL or null) ─────────────────────────
    const supabaseUpload = supabaseEnabled
      ? (async () => {
          try {
            const binary = atob(base64Jpeg);
            const bytes  = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const uploadRes = await fetch(
              `${supabaseUrl}/storage/v1/object/livewatch-frames/${storagePath}`,
              {
                method: 'POST',
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'image/jpeg',
                  'x-upsert': 'true',
                },
                body: bytes,
              }
            );

            // If bucket doesn't exist, create it (public) then retry once
            if (!uploadRes.ok) {
              const errText = await uploadRes.text();
              const bucketMissing = uploadRes.status === 404 ||
                errText.includes('Bucket not found') ||
                errText.includes('bucket') ||
                errText.includes('NoSuchBucket');

              if (bucketMissing) {
                log.warn('[LiveWatch] Storage bucket missing — creating livewatch-frames...');
                await fetch(`${supabaseUrl}/storage/v1/bucket`, {
                  method: 'POST',
                  headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ id: 'livewatch-frames', name: 'livewatch-frames', public: true }),
                });

                // Retry upload after bucket creation
                const retry = await fetch(
                  `${supabaseUrl}/storage/v1/object/livewatch-frames/${storagePath}`,
                  {
                    method: 'POST',
                    headers: {
                      apikey: supabaseKey,
                      Authorization: `Bearer ${supabaseKey}`,
                      'Content-Type': 'image/jpeg',
                      'x-upsert': 'true',
                    },
                    body: bytes,
                  }
                );
                if (!retry.ok) {
                  log.error('[LiveWatch] uploadThumbnail retry failed:', await retry.text());
                  return null;
                }
              } else {
                log.error('[LiveWatch] uploadThumbnail Supabase failed:', errText);
                return null;
              }
            }

            return `${supabaseUrl}/storage/v1/object/public/livewatch-frames/${storagePath}`;
          } catch (e) {
            log.error('[LiveWatch] uploadThumbnail Supabase error:', e);
            return null;
          }
        })()
      : Promise.resolve(null);

    // ── Drive upload (async, returns webViewLink or null) ────────────────────
    const driveUpload = sheetsEnabled
      ? (async () => {
          try {
            const { driveQuotaExceeded } = await chrome.storage.local.get('driveQuotaExceeded');
            if (driveQuotaExceeded) return null; // hard-stop until user clears flag

            const token = await getAuthToken(false);
            if (!token) return null;

            // Retrieve or resolve the Drive folder ID (cached across bursts).
            let { driveFolderId } = await chrome.storage.local.get('driveFolderId');
            if (!driveFolderId) {
              driveFolderId = await getOrCreateDriveFolder(token);
              if (driveFolderId) {
                await chrome.storage.local.set({ driveFolderId });
              }
            }
            if (!driveFolderId) return null;

            const result = await uploadFrameToDrive(base64Jpeg, filename, driveFolderId, token);

            // Handle Drive API error responses
            if (result?.status === 401) {
              log.warn('[LiveWatch] Drive 401 — clearing token, flagging expired');
              try { await revokeAuthToken(token); } catch (_) {}
              await chrome.storage.local.set({ googleDriveExpired: true });
              try {
                chrome.action.setBadgeText({ text: '!' });
                chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
              } catch (_) {}
              return null;
            }
            if (result?.status === 403 && /quota/i.test(result?.error ?? '')) {
              log.warn('[LiveWatch] Drive 403 storageQuotaExceeded — disabling Drive uploads');
              await chrome.storage.local.set({ driveQuotaExceeded: true });
              return null;
            }
            if (result?.status === 404) {
              // Folder may have been deleted — clear cache so next burst re-creates it
              await chrome.storage.local.remove('driveFolderId');
              return null;
            }

            return result?.webViewLink ?? null;
          } catch (e) {
            log.error('[LiveWatch] uploadThumbnail Drive error:', e);
            return null;
          }
        })()
      : Promise.resolve(null);

    // Run both in parallel; never block on either
    const [supabaseUrl_result, driveUrl] = await Promise.allSettled([
      supabaseUpload,
      driveUpload,
    ]).then((results) =>
      results.map((r) => (r.status === 'fulfilled' ? r.value : null))
    );

    // Prefer Supabase URL, fall back to Drive webViewLink
    return supabaseUrl_result ?? driveUrl ?? null;
  } catch (e) {
    log.error('[LiveWatch] uploadThumbnail error:', e);
    return null;
  }
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────

async function supabaseInsert(table, row) {
  try {
    const { supabaseUrl, supabaseKey } = await chrome.storage.local.get([
      'supabaseUrl',
      'supabaseKey',
    ]);
    if (!supabaseUrl || !supabaseKey) return { error: 'not_configured' };

    const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });

    if (!res.ok) return { error: await res.text() };
    return { data: await res.json() };
  } catch (e) {
    log.error(`[LiveWatch] supabaseInsert(${table}) error:`, e);
    return { error: String(e) };
  }
}

async function supabaseUpdate(table, id, updates) {
  try {
    const { supabaseUrl, supabaseKey } = await chrome.storage.local.get([
      'supabaseUrl',
      'supabaseKey',
    ]);
    if (!supabaseUrl || !supabaseKey) return { error: 'not_configured' };

    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(updates),
    });

    if (!res.ok) return { error: await res.text() };
    return { data: await res.json() };
  } catch (e) {
    log.error(`[LiveWatch] supabaseUpdate(${table}) error:`, e);
    return { error: String(e) };
  }
}

async function supabaseSelect(table, params = {}) {
  try {
    const { supabaseUrl, supabaseKey } = await chrome.storage.local.get([
      'supabaseUrl',
      'supabaseKey',
    ]);
    if (!supabaseUrl || !supabaseKey) return { error: 'not_configured' };

    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${supabaseUrl}/rest/v1/${table}?select=*${qs ? `&${qs}` : ''}`;

    const res = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!res.ok) return { error: await res.text() };
    return { data: await res.json() };
  } catch (e) {
    log.error(`[LiveWatch] supabaseSelect(${table}) error:`, e);
    return { error: String(e) };
  }
}

// ─── Google Sheets dual-write helper ─────────────────────────────────────────

/**
 * Fire-and-forget write to Google Sheets.
 * Silently skipped when Sheets is not configured or token is unavailable.
 *
 * @param {string} table - Sheet name (must be a key in SHEET_SCHEMAS)
 * @param {Record<string, unknown>} row - Row data matching the sheet schema
 * @returns {Promise<void>}
 */
async function sheetsWrite(table, row) {
  try {
    const { config = {} } = await chrome.storage.local.get('config');
    if (!config.sheetsConnected || !config.sheetsId) return;

    const token = await getAuthToken(false); // non-interactive, use cached token
    if (!token) return;

    await sheetsAppend(config.sheetsId, table, row, token);
  } catch (e) {
    log.warn('[LiveWatch] sheetsWrite error:', e);
  }
}

// ─── Pollinations vision analysis ─────────────────────────────────────────────

async function analyzeFrames(frames, meta) {
  const now = new Date().toISOString();
  try {
    const validFrames = frames.filter(Boolean);
    if (validFrames.length === 0) {
      log.error('[LiveWatch] analyzeFrames: no valid frames');
      return null;
    }

    const { pollinationsKey } = await chrome.storage.local.get('pollinationsKey');

    if (!pollinationsKey) {
      log.error('[LiveWatch] analyzeFrames: Pollinations API key not set');
      await chrome.storage.local.set({
        lastCaptureStatus: { step: 'error', message: 'กรุณาใส่ Pollinations API Key ใน Settings', at: now },
      });
      return null;
    }

    const url     = POLLINATIONS_URL_NEW;
    const model   = POLLINATIONS_MODEL;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${pollinationsKey}`,
    };

    const prompt = `You are a JSON-only API analyzing a TikTok Live selling stream.
You are given ${validFrames.length} frames captured 5 seconds apart (frame 1 → frame 2 → frame 3).
Use ALL frames together to understand the full context of what is happening.

Respond with ONLY this JSON object — no markdown, no extra text:
{
  "presenter_visible": true,       // มีคนอยู่ในเฟรมไหม
  "eye_contact_score": 75,         // มองกล้อง 0-100
  "smile_score": 80,               // ยิ้มแย้ม 0-100 (ดูรวมทั้งสีหน้า ไม่ใช่แค่ปาก — ถ้าพูดแอคทีฟก็ถือว่า engage)
  "energy_level": 70,              // พลังงาน/ความกระตือรือร้น 0-100
  "engagement_score": 75,          // ความ engage กับ live โดยรวม (รวม eye contact + พูดแอคทีฟ + มองกล้อง + อ่าน comment)
  "distracted": false,             // หันไปคุยนอกกล้อง หรือเงียบนิ่งนานผิดปกติ
  "phone_detected": false,         // ถือมือถือในเฟรม
  "multiple_people": false,        // มีคนอื่นโผล่โดยไม่ตั้งใจ
  "product_presenting": true,      // กำลังแสดง/ถือสินค้า
  "demo_in_progress": false,       // กำลัง demo วิธีใช้สินค้า
  "lighting_quality": 85,          // แสง 0-100
  "background_clean": true,        // พื้นหลังเรียบร้อย
  "activity_summary": "Presenter actively talking and reading comments, holding product",
  "alert_flag": false              // true ถ้ามีปัญหา
}

Scoring rules:
- eye_contact_score: averaged across all frames. Reading comments = ~40, looking away = 10, direct camera gaze = 90+
- smile_score: score the overall positive facial expression and energy, NOT just mouth shape. Active talking with expressive face = 60+, genuinely smiling = 80+, flat/bored = 20
- engagement_score: holistic score — is this presenter actively working the live? Talking, gesturing, reacting to comments all count
- energy_level: 0=sleepy/still, 100=very animated, moving, gesturing enthusiastically
- distracted: true only if clearly ignoring the live audience for extended time
- alert_flag: true if ANY: phone_detected in 2+ frames, eye_contact_score<20, energy_level<15, distracted=true`;

    const content = [
      { type: 'text', text: prompt },
      ...validFrames.map((b64) => ({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${b64}` },
      })),
    ];

    log.info(`[LiveWatch] analyzeFrames: ${url} model=${model}, frames=${validFrames.length}`);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' },
          temperature: 0,
        }),
      });
    } catch (fetchErr) {
      log.error('[LiveWatch] analyzeFrames: network error:', fetchErr?.message);
      await chrome.storage.local.set({
        lastCaptureStatus: { step: 'error', message: `Network error: ${fetchErr?.message}`, at: now },
      });
      return null;
    }

    const rawText = await res.text();
    log.info(`[LiveWatch] analyzeFrames: HTTP ${res.status}, len=${rawText.length}`);
    log.info('[LiveWatch] analyzeFrames raw:', rawText.substring(0, 400));

    if (!res.ok) {
      log.error('[LiveWatch] analyzeFrames HTTP error:', res.status, rawText.substring(0, 300));
      await chrome.storage.local.set({
        lastCaptureStatus: { step: 'error', message: `API ${res.status}: ${rawText.substring(0, 100)}`, at: now },
      });
      return null;
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      await chrome.storage.local.set({
        lastCaptureStatus: { step: 'error', message: `Response not JSON`, at: now },
      });
      return null;
    }

    const text = data?.choices?.[0]?.message?.content ?? '';
    log.info('[LiveWatch] analyzeFrames model content:', text);

    const stripped = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.error('[LiveWatch] analyzeFrames: no JSON in:', stripped.substring(0, 200));
      await chrome.storage.local.set({
        lastCaptureStatus: { step: 'error', message: `Model returned: ${stripped.substring(0, 100)}`, at: now },
      });
      return null;
    }

    try {
      const result = JSON.parse(jsonMatch[0]);
      log.info('[LiveWatch] analyzeFrames OK:', result);
      return result;
    } catch (parseErr) {
      await chrome.storage.local.set({
        lastCaptureStatus: { step: 'error', message: `JSON parse error`, at: now },
      });
      return null;
    }
  } catch (e) {
    log.error('[LiveWatch] analyzeFrames unhandled error:', e);
    return null;
  }
}

// ─── LINE helpers ─────────────────────────────────────────────────────────────

async function lineCredentials() {
  const { lineToken, lineUserId } = await chrome.storage.local.get(['lineToken', 'lineUserId']);
  return (lineToken && lineUserId) ? { lineToken, lineUserId } : null;
}

async function sendLineMessage(text) {
  const creds = await lineCredentials();
  if (!creds) {
    log.warn('[LiveWatch] LINE credentials not configured, skipping');
    return false;
  }
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.lineToken}`,
    },
    body: JSON.stringify({ to: creds.lineUserId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    log.error('[LiveWatch] LINE push failed:', res.status, await res.text());
    return false;
  }
  return true;
}

async function sendCaptureAlert(scores, capturedAt, thumbnailUrl) {
  const timeStr = new Date(capturedAt).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit',
  });

  const bar = (score) => {
    const filled = Math.round((score / 100) * 5);
    return '█'.repeat(filled) + '░'.repeat(5 - filled) + ` ${score}`;
  };

  const lines = [
    scores.alert_flag ? `⚠️ แจ้งเตือน!` : `✅ ปกติ`,
    `📸 ผลวิเคราะห์ไลฟ์ (${timeStr} น.)`,
    ``,
    `😊 ยิ้มแย้ม    ${bar(scores.smile_score        ?? 0)}`,
    `👁 มองกล้อง   ${bar(scores.eye_contact_score   ?? 0)}`,
    `⚡ พลังงาน    ${bar(scores.energy_level         ?? 0)}`,
    `🎯 Engage     ${bar(scores.engagement_score     ?? 0)}`,
    `💡 แสง        ${bar(scores.lighting_quality     ?? 0)}`,
    ``,
    scores.phone_detected     ? `📱 ⚠️ ถือมือถือ!`    : `📱 ไม่ถือมือถือ`,
    scores.product_presenting ? `📦 กำลังเสนอสินค้า`  : `📦 ยังไม่เสนอสินค้า`,
    scores.demo_in_progress   ? `🎬 กำลัง demo สินค้า` : null,
    scores.distracted         ? `😶 ⚠️ ไม่ engage`      : null,
    scores.multiple_people    ? `👥 มีคนอื่นในเฟรม`    : null,
    !scores.background_clean  ? `🗂 พื้นหลังรกเกินไป`   : null,
  ].filter(Boolean);

  if (scores.activity_summary) {
    lines.push(``, `💬 ${scores.activity_summary}`);
  }

  const creds = await lineCredentials();
  if (!creds) return;

  // Build messages array: image first (if available), then text
  const messages = [];

  if (thumbnailUrl) {
    messages.push({
      type: 'image',
      originalContentUrl: thumbnailUrl,
      previewImageUrl:    thumbnailUrl,
    });
  }

  messages.push({ type: 'text', text: lines.join('\n') });

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.lineToken}`,
    },
    body: JSON.stringify({ to: creds.lineUserId, messages }),
  });

  if (!res.ok) {
    log.error('[LiveWatch] sendCaptureAlert LINE failed:', res.status, await res.text());
  }
}

// ─── LINE daily summary ───────────────────────────────────────────────────────

async function sendDailySummary() {
  try {
    const { lineToken, lineUserId } = await chrome.storage.local.get([
      'lineToken',
      'lineUserId',
    ]);
    if (!lineToken || !lineUserId) {
      log.warn('[LiveWatch] sendDailySummary: LINE credentials not configured');
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: logs, error: logsErr } = await supabaseSelect('analysis_logs', {
      captured_at: `gte.${today}T00:00:00Z`,
    });

    if (logsErr) {
      log.error('[LiveWatch] sendDailySummary: failed to fetch analysis_logs:', logsErr);
      return;
    }

    if (!logs || logs.length === 0) {
      log.info('[LiveWatch] sendDailySummary: no logs for today, skipping');
      return;
    }

    const totalBursts = logs.length;
    const alertCount = logs.filter((l) => l.alert_flag).length;
    const phoneIncidents = logs.filter((l) => l.phone_detected).length;
    const avgSmile = Math.round(
      logs.reduce((s, l) => s + (l.smile_score || 0), 0) / totalBursts
    );
    const avgEye = Math.round(
      logs.reduce((s, l) => s + (l.eye_contact_score || 0), 0) / totalBursts
    );
    const productPct = Math.round(
      (logs.filter((l) => l.product_presenting).length / totalBursts) * 100
    );

    const { data: sessions } = await supabaseSelect('sessions', {
      started_at: `gte.${today}T00:00:00Z`,
    });
    const totalMins = (sessions || []).reduce(
      (s, sess) => s + (sess.duration_mins || 0),
      0
    );
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;

    const dateStr = new Date().toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const message = [
      `📊 สรุปไลฟ์วันนี้ (${dateStr})`,
      ``,
      `⏱ ไลฟ์ทั้งหมด: ${hours} ชั่วโมง ${mins} นาที`,
      `😊 ยิ้มแย้มเฉลี่ย: ${avgSmile}/100`,
      `👁 มองกล้องเฉลี่ย: ${avgEye}/100`,
      `📦 เสนอสินค้า: ${productPct}% ของเวลา`,
      `📱 จับมือถือ: ${phoneIncidents} ครั้ง`,
      alertCount > 0
        ? `⚠️ รายงานผิดปกติ: ${alertCount} ครั้ง`
        : `✅ ไม่พบพฤติกรรมผิดปกติ`,
    ].join('\n');

    const ok = await sendLineMessage(message);
    if (ok) log.info('[LiveWatch] Daily LINE summary sent successfully');

    await supabaseInsert('daily_summaries', {
      summary_date: today,
      total_bursts: totalBursts,
      alert_count: alertCount,
      phone_incidents: phoneIncidents,
      avg_smile_score: avgSmile,
      avg_eye_contact_score: avgEye,
      product_presenting_pct: productPct,
      total_live_mins: totalMins,
      line_sent_at: new Date().toISOString(),
    });
  } catch (e) {
    log.error('[LiveWatch] sendDailySummary error:', e);
  }
}

// ─── Hourly LINE report ───────────────────────────────────────────────────────

async function sendHourlyReport() {
  try {
    const creds = await lineCredentials();
    if (!creds) return;

    const { recentCaptures = [] } = await chrome.storage.local.get('recentCaptures');

    // Filter captures from the last hour
    const cutoff  = new Date(Date.now() - HOURLY_REPORT_PERIOD * 60 * 1000).toISOString();
    const hourly  = recentCaptures.filter(c => c.captured_at >= cutoff);

    if (hourly.length === 0) {
      log.info('[LiveWatch] sendHourlyReport: no captures in last hour, skipping');
      return;
    }

    // Compute averages
    const count       = hourly.length;
    const avgSmile    = Math.round(hourly.reduce((s, c) => s + c.smile_score,       0) / count);
    const avgEye      = Math.round(hourly.reduce((s, c) => s + c.eye_contact_score, 0) / count);
    const avgEnergy   = Math.round(hourly.reduce((s, c) => s + c.energy_level,      0) / count);
    const avgEngage   = Math.round(hourly.reduce((s, c) => s + c.engagement_score,  0) / count);
    const alerts      = hourly.filter(c => c.alert_flag).length;
    const phones      = hourly.filter(c => c.phone_detected).length;
    const distractedN = hourly.filter(c => c.distracted).length;
    const productPct  = Math.round((hourly.filter(c => c.product_presenting).length / count) * 100);

    const bar = (score) => {
      const filled = Math.round((score / 100) * 5);
      return '█'.repeat(filled) + '░'.repeat(5 - filled) + ` ${score}`;
    };

    const now     = new Date();
    const toHH    = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const fromTime = toHH(new Date(Date.now() - HOURLY_REPORT_PERIOD * 60 * 1000));
    const toTime   = toHH(now);

    const summary = [
      `📊 รายงานไลฟ์ ${fromTime}–${toTime} น.`,
      ``,
      `😊 ยิ้มแย้ม  ${bar(avgSmile)}`,
      `👁 มองกล้อง ${bar(avgEye)}`,
      `⚡ พลังงาน  ${bar(avgEnergy)}`,
      `🎯 Engage   ${bar(avgEngage)}`,
      ``,
      `📦 เสนอสินค้า: ${productPct}%`,
      `📱 ถือมือถือ: ${phones} ครั้ง`,
      distractedN > 0 ? `😶 ไม่ engage: ${distractedN} ครั้ง` : null,
      alerts > 0 ? `⚠️ แจ้งเตือน: ${alerts} ครั้ง` : `✅ ไม่มีพฤติกรรมผิดปกติ`,
      ``,
      `🔍 วิเคราะห์ ${count} ครั้ง`,
    ].filter(Boolean).join('\n');

    // Collect unique thumbnail URLs (skip nulls, max 4 images per LINE push)
    const imageUrls = [...new Set(
      hourly.map(c => c.thumbnail_url).filter(Boolean)
    )].slice(0, 4);

    // Build messages: images first, then summary text (LINE max 5 per push)
    const messages = [
      ...imageUrls.map(url => ({
        type: 'image',
        originalContentUrl: url,
        previewImageUrl:    url,
      })),
      { type: 'text', text: summary },
    ];

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.lineToken}`,
      },
      body: JSON.stringify({ to: creds.lineUserId, messages }),
    });

    if (res.ok) {
      log.info(`[LiveWatch] Hourly LINE report sent (${count} captures, ${imageUrls.length} images)`);
    } else {
      log.error('[LiveWatch] Hourly LINE report failed:', res.status, await res.text());
    }
  } catch (e) {
    log.error('[LiveWatch] sendHourlyReport error:', e);
  }
}

// ─── Alarm scheduling ─────────────────────────────────────────────────────────

function minutesUntilHour(targetHour) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(targetHour, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return Math.round((target - now) / 60000);
}

async function scheduleDailyAlarm() {
  try {
    await chrome.alarms.clear(ALARM_DAILY);
    const delayInMinutes = minutesUntilHour(DAILY_SUMMARY_HOUR);
    await chrome.alarms.create(ALARM_DAILY, {
      delayInMinutes,
      periodInMinutes: 1440,
    });
    log.info(
      `[LiveWatch] Daily summary alarm scheduled in ${delayInMinutes} minutes`
    );
  } catch (e) {
    log.error('[LiveWatch] scheduleDailyAlarm error:', e);
  }
}

async function startCaptureAlarm() {
  try {
    const { config = {} } = await chrome.storage.local.get('config');
    const userInterval = Number(config.captureInterval) || CAPTURE_INTERVAL_MINUTES;
    const tierLimits = await getCachedTier();
    const interval = effectiveCaptureInterval(userInterval, tierLimits);
    await chrome.alarms.clear(ALARM_CAPTURE);
    await chrome.alarms.create(ALARM_CAPTURE, {
      delayInMinutes: interval,
      periodInMinutes: interval,
    });
    log.info(`[LiveWatch] captureBurst alarm scheduled every ${interval} min (tier=${tierLimits.tier})`);
  } catch (e) {
    log.error('[LiveWatch] startCaptureAlarm error:', e);
  }
}

async function scheduleHourlyAlarm() {
  try {
    await chrome.alarms.clear(ALARM_HOURLY);
    await chrome.alarms.create(ALARM_HOURLY, {
      delayInMinutes: HOURLY_REPORT_PERIOD,
      periodInMinutes: HOURLY_REPORT_PERIOD,
    });
    log.info('[LiveWatch] Hourly report alarm scheduled (every 60 min)');
  } catch (e) {
    log.error('[LiveWatch] scheduleHourlyAlarm error:', e);
  }
}

async function clearCaptureAlarm() {
  try {
    await chrome.alarms.clear(ALARM_CAPTURE);
  } catch (e) {
    log.error('[LiveWatch] clearCaptureAlarm error:', e);
  }
}

// ─── Session management ───────────────────────────────────────────────────────

async function startSession(tabId) {
  try {
    const startedAt = new Date().toISOString();
    let tabUrl = null;
    try {
      const tab = await chrome.tabs.get(tabId);
      tabUrl = tab.url ?? null;
    } catch (_) { /* tab may not be accessible */ }

    const sessionRow = {
      started_at: startedAt,
      tab_url: tabUrl,
    };

    const { data, error } = await supabaseInsert('sessions', sessionRow);

    if (error && error !== 'not_configured') {
      log.error('[LiveWatch] startSession insert failed:', error);
    }

    // Use Supabase-assigned ID if available, otherwise generate a local UUID
    // so the extension can still track sessions without a database backend.
    const session = Array.isArray(data) ? data[0] : data;
    const sessionId = session?.id ?? crypto.randomUUID();

    // Dual-write to Google Sheets (fire-and-forget)
    sheetsWrite('sessions', { ...sessionRow, id: sessionId }).catch((e) =>
      log.warn('[LiveWatch] Sheets write failed:', e)
    );

    return sessionId;
  } catch (e) {
    log.error('[LiveWatch] startSession error:', e);
    return null;
  }
}

async function endSession(sessionId, startedAt) {
  if (!sessionId) return;
  try {
    const endedAt = new Date().toISOString();
    let durationMins = 0;

    // Calculate duration if startedAt is available in state
    const { extensionState } = await chrome.storage.local.get('extensionState');
    const sessionStartedAt = extensionState?.sessionStartedAt;
    if (sessionStartedAt) {
      durationMins = Math.round(
        (new Date(endedAt) - new Date(sessionStartedAt)) / 60000
      );
    }

    await supabaseUpdate('sessions', sessionId, {
      ended_at: endedAt,
      duration_mins: durationMins,
    });

    // Dual-write session end to Google Sheets (fire-and-forget)
    sheetsWrite('sessions', {
      id: sessionId,
      ended_at: endedAt,
      duration_mins: durationMins,
    }).catch((e) => log.warn('[LiveWatch] Sheets write failed:', e));
  } catch (e) {
    log.error('[LiveWatch] endSession error:', e);
  }
}

// ─── Tab lifecycle ────────────────────────────────────────────────────────────

async function ensureContentScript(tabId) {
  try {
    // Check if content script is already active by pinging it
    const pong = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
        resolve(chrome.runtime.lastError ? null : res);
      });
    });
    if (pong) return; // already injected

    // Not injected — inject programmatically
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content.js'],
    });
    log.info('[LiveWatch] content.js injected programmatically into tab', tabId);
  } catch (e) {
    log.warn('[LiveWatch] ensureContentScript failed:', e?.message);
  }
}

async function setLiveTab(tabId) {
  try {
    if (state.liveTabId === tabId && state.status !== STATUS.OFFLINE) {
      // Already tracking this tab
      return;
    }

    log.info('[LiveWatch] setLiveTab:', tabId);

    // Make sure content script is running before we try to send CAPTURE_BURST
    await ensureContentScript(tabId);

    // End any existing session first
    if (state.sessionId) {
      await endSession(state.sessionId);
    }

    const sessionId = await startSession(tabId);
    const sessionStartedAt = new Date().toISOString();

    state = {
      ...state,
      status: STATUS.MONITORING,
      liveTabId: tabId,
      sessionId,
      lastHeartbeat: Date.now(),
    };

    // Persist sessionStartedAt separately for duration calc
    await chrome.storage.local.set({ extensionState: { ...state, sessionStartedAt } });

    await startCaptureAlarm();
    await scheduleStatsAlarm();
    await scheduleChatBatchAlarm();

    log.info('[LiveWatch] Now monitoring tab', tabId, 'session', sessionId);
  } catch (e) {
    log.error('[LiveWatch] setLiveTab error:', e);
    state.status = STATUS.MONITORING;
    await saveState();
  }
}

async function goOffline() {
  try {
    log.info('[LiveWatch] goOffline, ending session', state.sessionId);

    await clearCaptureAlarm();
    await clearStatsAlarm();
    await clearChatBatchAlarm();

    if (state.sessionId) {
      await endSession(state.sessionId);
    }

    state = {
      status: STATUS.OFFLINE,
      liveTabId: null,
      sessionId: null,
      lastHeartbeat: 0,
    };

    await chrome.storage.local.set({
      extensionState: state,
      sessionStartedAt: null,
      statsBuffer: [],
      lastStats: null,
    });
    await chrome.storage.local.remove([
      'chatBuffer',
      'lastChatSentiment',
      'endingSession',
      'roomEnded',
      'sessionSummary',
    ]);
  } catch (e) {
    log.error('[LiveWatch] goOffline error:', e);
    // Force offline even on error
    state = {
      status: STATUS.OFFLINE,
      liveTabId: null,
      sessionId: null,
      lastHeartbeat: 0,
    };
  }
}

async function scanTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const liveTab = tabs.find((t) => TIKTOK_LIVE_PATTERN.test(t.url ?? ''));

    if (liveTab) {
      if (state.liveTabId !== liveTab.id || state.status === STATUS.OFFLINE) {
        await setLiveTab(liveTab.id);
      }
    } else if (state.status !== STATUS.OFFLINE) {
      // No live tab found — go offline
      await goOffline();
    }
  } catch (e) {
    log.error('[LiveWatch] scanTabs error:', e);
  }
}

// ─── Capture burst ────────────────────────────────────────────────────────────

async function triggerBurst() {
  if (!state.liveTabId || state.status === STATUS.OFFLINE) return;

  // Don't interrupt an in-progress capture/analyze cycle
  if (state.status === STATUS.CAPTURING || state.status === STATUS.ANALYZING) {
    log.warn('[LiveWatch] triggerBurst: already in progress, skipping');
    return;
  }

  // Tier floor: enforce minimum gap between bursts (fail-safe to gold).
  try {
    const tierLimits = await getCachedTier();
    const { lastBurstAt = 0 } = await chrome.storage.local.get('lastBurstAt');
    const minGapMs = tierLimits.minIntervalMinutes * 60 * 1000;
    if (Date.now() - lastBurstAt < minGapMs) {
      console.warn('[LiveWatch] tier floor: burst suppressed, too soon');
      return;
    }
    await chrome.storage.local.set({ lastBurstAt: Date.now() });
  } catch (e) {
    log.warn('[LiveWatch] tier floor check failed:', e?.message);
  }

  state.status = STATUS.CAPTURING;
  await saveState();

  let response;
  try {
    response = await chrome.tabs.sendMessage(state.liveTabId, {
      type: MSG.CAPTURE_BURST,
    });
  } catch (e) {
    log.warn('[LiveWatch] triggerBurst: sendMessage failed, retrying with inject:', e?.message);
    // Content script not running — inject it and retry once
    await ensureContentScript(state.liveTabId);
    await new Promise(r => setTimeout(r, 500));
    try {
      response = await chrome.tabs.sendMessage(state.liveTabId, { type: MSG.CAPTURE_BURST });
    } catch (e2) {
      log.error('[LiveWatch] triggerBurst: retry also failed:', e2?.message);
      state.status = STATUS.MONITORING;
      await saveState();
      return;
    }
  }

  if (!response || response.error || !response.frames?.length) {
    log.warn('[LiveWatch] triggerBurst: invalid response from content:', response);
    state.status = STATUS.MONITORING;
    await saveState();
    return;
  }

  // Save the first frame immediately so popup shows it even if analysis fails
  const capturedAt = response.meta?.timestamp ?? new Date().toISOString();
  await chrome.storage.local.set({
    lastFrame: response.frames[0],
    lastCaptureStatus: { step: 'captured', frames: response.frames.length, at: capturedAt },
  });

  state.status = STATUS.ANALYZING;
  await saveState();

  log.info(`[LiveWatch] analyzeFrames: sending ${response.frames.length} frames to Pollinations...`);
  const scores = await analyzeFrames(response.frames, response.meta);
  log.info('[LiveWatch] analyzeFrames result:', scores);

  if (!scores) {
    await chrome.storage.local.set({
      lastCaptureStatus: { step: 'error', message: 'Pollinations ไม่ตอบกลับหรือ parse JSON ไม่ได้', at: capturedAt },
    });
  }

  if (scores) {
    // Upload first frame as thumbnail to Supabase Storage
    const thumbnailUrl = response.frames?.[0]
      ? await uploadThumbnail(response.frames[0], state.sessionId, capturedAt)
      : null;

    // Accumulate today's stats in local storage
    const today = capturedAt.substring(0, 10);
    const { todayStats } = await chrome.storage.local.get('todayStats');
    const stats = (todayStats?.date === today)
      ? todayStats
      : { date: today, bursts: 0, alerts: 0, phones: 0, smileSum: 0, eyeSum: 0 };
    stats.bursts++;
    if (scores.alert_flag)     stats.alerts++;
    if (scores.phone_detected) stats.phones++;
    stats.smileSum += scores.smile_score       ?? 0;
    stats.eyeSum   += scores.eye_contact_score ?? 0;

    // Send LINE alert for every capture (with image if Supabase is configured)
    sendCaptureAlert(scores, capturedAt, thumbnailUrl).catch(e =>
      log.error('[LiveWatch] sendCaptureAlert error:', e)
    );

    // Append to recentCaptures ring buffer (used for hourly report)
    const { recentCaptures = [] } = await chrome.storage.local.get('recentCaptures');
    const newCapture = {
      captured_at:        capturedAt,
      smile_score:        scores.smile_score        ?? 0,
      eye_contact_score:  scores.eye_contact_score  ?? 0,
      energy_level:       scores.energy_level       ?? 0,
      engagement_score:   scores.engagement_score   ?? 0,
      lighting_quality:   scores.lighting_quality   ?? 0,
      phone_detected:     scores.phone_detected     ?? false,
      product_presenting: scores.product_presenting ?? false,
      presenter_visible:  scores.presenter_visible  ?? false,
      distracted:         scores.distracted         ?? false,
      alert_flag:         scores.alert_flag         ?? false,
      activity_summary:   scores.activity_summary   ?? '',
      thumbnail_url:      thumbnailUrl,
    };
    const updatedCaptures = [...recentCaptures, newCapture].slice(-MAX_RECENT_CAPTURES);

    // Save analysis result + stats
    await chrome.storage.local.set({
      lastAnalysis: {
        ...scores,
        captured_at: capturedAt,
        thumbnail_url: thumbnailUrl,
        meta: response.meta,
      },
      todayStats: stats,
      recentCaptures: updatedCaptures,
      lastCaptureStatus: { step: 'done', smile: scores.smile_score, eye: scores.eye_contact_score, energy: scores.energy_level, at: capturedAt },
    });

    // Also try Supabase (silently skipped if not configured)
    const analysisRow = {
      session_id: state.sessionId,
      captured_at: capturedAt,
      phone_detected: scores.phone_detected ?? false,
      eye_contact_score: scores.eye_contact_score ?? 0,
      smile_score: scores.smile_score ?? 0,
      product_presenting: scores.product_presenting ?? false,
      presenter_visible: scores.presenter_visible ?? false,
      activity_summary: scores.activity_summary ?? '',
      alert_flag: scores.alert_flag ?? false,
      thumbnail_url: thumbnailUrl,
      raw_scores: scores,
    };

    const { error } = await supabaseInsert('analysis_logs', analysisRow);

    if (error && error !== 'not_configured') {
      log.error('[LiveWatch] triggerBurst: failed to insert analysis_log:', error);
    }

    // Dual-write to Google Sheets (fire-and-forget)
    sheetsWrite('analysis_logs', analysisRow).catch((e) =>
      log.warn('[LiveWatch] Sheets write failed:', e)
    );
  } else {
    log.warn('[LiveWatch] triggerBurst: analyzeFrames returned null, skipping insert');
  }

  state.status = STATUS.MONITORING;
  await saveState();
}

// ─── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === ALARM_SCAN) {
      await scanTabs();
    } else if (alarm.name === ALARM_REFRESH_TIER) {
      const { config = {} } = await chrome.storage.local.get('config');
      if (config.apiBase && config.apiToken) {
        await refreshTierCache(config.apiBase, config.apiToken);
        // Re-schedule capture alarm in case the tier floor changed
        if (state.status !== STATUS.OFFLINE) {
          await startCaptureAlarm();
        }
      }
    } else if (alarm.name === ALARM_CAPTURE) {
      await triggerBurst();
    } else if (alarm.name === ALARM_HOURLY) {
      await sendHourlyReport();
    } else if (alarm.name === ALARM_DAILY) {
      await sendDailySummary();
    } else if (alarm.name === 'statsPoll') {
      await loadState();
      if (state.liveTabId && state.sessionId) {
        const s = { ...state };
        const stats = await handleStatsPoll(s.liveTabId, s.sessionId);
        // Check if live ended by room status
        if (stats?.room_status === 4) {
          const { roomEnded } = await chrome.storage.local.get('roomEnded');
          if (roomEnded?.sessionId === s.sessionId) {
            const { pollinationsKey } = await chrome.storage.local.get('pollinationsKey');
            const cfg = { pollinationsKey: pollinationsKey ?? null };
            await finalizeSession(s.sessionId, cfg);
            await goOffline();
          }
        }
      }
    } else if (alarm.name === 'chatBatch') {
      await loadState();
      if (state.sessionId) {
        const { pollinationsKey } = await chrome.storage.local.get('pollinationsKey');
        const cfg = { pollinationsKey: pollinationsKey ?? null };
        await flushChatBuffer(state.sessionId);
        await runChatSentimentBatch(state.sessionId, cfg);
      }
    }
  } catch (e) {
    log.error('[LiveWatch] alarms.onAlarm unhandled error:', alarm.name, e);
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  try {
    if (msg.type === MSG.LIVE_STARTED) {
      const tabId = sender.tab?.id ?? null;
      if (tabId !== null) {
        setLiveTab(tabId).catch((e) =>
          log.error('[LiveWatch] LIVE_STARTED setLiveTab error:', e)
        );
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === MSG.LIVE_ENDED) {
      const s = { ...state };
      (async () => {
        try {
          // Only finalize if not already being finalized by room_status detection
          const { endingSession } = await chrome.storage.local.get('endingSession');
          if (!endingSession && s.sessionId) {
            const { pollinationsKey } = await chrome.storage.local.get('pollinationsKey');
            const cfg = { pollinationsKey: pollinationsKey ?? null };
            await finalizeSession(s.sessionId, cfg);
          }
        } catch (e) {
          log.error('[LiveWatch] LIVE_ENDED finalizeSession error:', e);
        }
        await goOffline();
      })().catch((e) =>
        log.error('[LiveWatch] LIVE_ENDED error:', e)
      );
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === MSG.HEARTBEAT) {
      state.lastHeartbeat = Date.now();
      if (!msg.alive) {
        goOffline().catch((e) =>
          log.error('[LiveWatch] HEARTBEAT goOffline error:', e)
        );
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === MSG.GET_STATUS) {
      sendResponse({ ...state });
      return true;
    }

    if (msg.type === 'RECONNECT_DRIVE') {
      (async () => {
        try {
          const token = await getAuthToken(true);
          if (token) {
            await chrome.storage.local.remove(['googleDriveExpired', 'driveQuotaExceeded']);
            try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'no_token' });
          }
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true; // async
    }

    if (msg.type === 'RESET_TIER_CACHE') {
      (async () => {
        try {
          const { config = {} } = await chrome.storage.local.get('config');
          const fresh = await refreshTierCache(config.apiBase, config.apiToken);
          if (state.status !== STATUS.OFFLINE) {
            await startCaptureAlarm();
          }
          sendResponse({ ok: true, tier: fresh });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true; // async
    }

    if (msg.type === MSG.TEST_BURST) {
      // Manual trigger for testing — runs immediately regardless of interval
      triggerBurst()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true; // async
    }

    if (msg.type === 'CHAT_MSG') {
      const s = { ...state };
      if (s.sessionId) {
        appendChatMessage(msg.msg, s.sessionId).catch((e) =>
          log.error('[LiveWatch] CHAT_MSG appendChatMessage error:', e)
        );
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'WS_MSG') {
      // Log raw WS frames for future protobuf decoding — acknowledge only for now.
      sendResponse({ ok: true });
      return false;
    }
  } catch (e) {
    log.error('[LiveWatch] onMessage unhandled error:', msg.type, e);
    sendResponse({ error: String(e) });
  }

  return false;
});

// ─── Tab event listeners ──────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  try {
    // Only react when a URL is committed (fully navigated)
    if (info.status !== 'complete') return;

    const url = tab.url ?? '';

    if (TIKTOK_LIVE_PATTERN.test(url)) {
      // New or reloaded live tab
      if (state.liveTabId !== tabId || state.status === STATUS.OFFLINE) {
        setLiveTab(tabId).catch((e) =>
          log.error('[LiveWatch] onUpdated setLiveTab error:', e)
        );
      }
    } else if (tabId === state.liveTabId) {
      // Live tab navigated away from live page
      goOffline().catch((e) =>
        log.error('[LiveWatch] onUpdated goOffline error:', e)
      );
    }
  } catch (e) {
    log.error('[LiveWatch] tabs.onUpdated error:', e);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    if (tabId === state.liveTabId) {
      goOffline().catch((e) =>
        log.error('[LiveWatch] onRemoved goOffline error:', e)
      );
    }
  } catch (e) {
    log.error('[LiveWatch] tabs.onRemoved error:', e);
  }
});

// ─── Startup / install ────────────────────────────────────────────────────────

async function initialize() {
  try {
    await loadState();

    // If we were mid-capture when the service worker was killed, reset to safe state
    if (
      state.status === STATUS.CAPTURING ||
      state.status === STATUS.ANALYZING
    ) {
      state.status = STATUS.MONITORING;
      await saveState();
    }

    // Ensure the periodic scan alarm exists
    const scanAlarm = await chrome.alarms.get(ALARM_SCAN);
    if (!scanAlarm) {
      await chrome.alarms.create(ALARM_SCAN, {
        delayInMinutes: 1,
        periodInMinutes: 2,
      });
    }

    // Schedule daily summary and hourly report
    await scheduleDailyAlarm();
    await scheduleHourlyAlarm();

    // Refresh user tier from SaaS backend every 6 hours
    const tierAlarm = await chrome.alarms.get(ALARM_REFRESH_TIER);
    if (!tierAlarm) {
      await chrome.alarms.create(ALARM_REFRESH_TIER, {
        delayInMinutes: 1,
        periodInMinutes: 360,
      });
    }

    // Scan for existing live tabs
    await scanTabs();
  } catch (e) {
    log.error('[LiveWatch] initialize error:', e);
  }
}

chrome.runtime.onStartup.addListener(() => {
  initialize().catch((e) => log.error('[LiveWatch] onStartup error:', e));
});

chrome.runtime.onInstalled.addListener((details) => {
  // On update, purge any stale implicit-flow OAuth token from previous versions.
  if (details?.reason === 'update') {
    chrome.storage.local.remove(['googleOAuthToken', 'driveFolderId']).catch(() => {});
  }
  initialize().catch((e) => log.error('[LiveWatch] onInstalled error:', e));
});

// Re-create capture alarm when user changes captureInterval in settings,
// applying the tier floor.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.captureInterval && state.status !== STATUS.OFFLINE) {
    startCaptureAlarm().catch((e) =>
      log.error('[LiveWatch] storage.onChanged startCaptureAlarm error:', e)
    );
  }
});

// Run initialize immediately in case the service worker woke up without a startup/install event
initialize().catch((e) =>
  log.error('[LiveWatch] top-level initialize error:', e)
);
