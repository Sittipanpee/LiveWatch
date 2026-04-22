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
import { analyzeFrames } from './ai.js';
import { scheduleAnalyticsScrape } from './analytics.js';

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

// ─── SaaS REST helpers ────────────────────────────────────────────────────────

/**
 * POST to the SaaS backend with the user's apiToken.
 * Returns { data, error } — error is a string or null.
 *
 * @param {string} path - e.g. '/api/sessions'
 * @param {object} body
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
async function saasPost(path, body) {
  const { config = {} } = await chrome.storage.local.get('config');
  const apiToken = config.apiToken;
  const apiBase = (config.apiBase || 'https://livewatch-psi.vercel.app').replace(/\/$/, '');
  if (!apiToken) return { data: null, error: 'no_token' };
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: data.error ?? String(res.status) };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

/**
 * PATCH to the SaaS backend with the user's apiToken.
 * Returns { data, error } — error is a string or null.
 *
 * @param {string} path - e.g. '/api/sessions/abc-123'
 * @param {object} body
 * @returns {Promise<{data: object|null, error: string|null}>}
 */
async function saasPatch(path, body) {
  const { config = {} } = await chrome.storage.local.get('config');
  const apiToken = config.apiToken;
  const apiBase = (config.apiBase || 'https://livewatch-psi.vercel.app').replace(/\/$/, '');
  if (!apiToken) return { data: null, error: 'no_token' };
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: data.error ?? String(res.status) };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

// ─── Thumbnail upload (SaaS proxy + Supabase Storage + Google Drive in parallel) ─

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

    // ── SaaS proxy upload (primary path) ────────────────────────────────────
    const saasUpload = (() => {
      if (!config.apiToken) return Promise.resolve(null);
      const apiBase = (config.apiBase || 'https://livewatch-psi.vercel.app').replace(/\/$/, '');
      return fetch(`${apiBase}/api/frames/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiToken}`,
        },
        body: JSON.stringify({ base64: base64Jpeg, session_id: sessionId, captured_at: capturedAt }),
      })
        .then((res) => {
          if (!res.ok) return null;
          return res.json().then((json) => json.url ?? null);
        })
        .catch(() => null);
    })();

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

    // Run all three in parallel; never block on any
    const [saasUrl, supabaseUrl_result, driveUrl] = await Promise.allSettled([
      saasUpload,
      supabaseUpload,
      driveUpload,
    ]).then((results) =>
      results.map((r) => (r.status === 'fulfilled' ? r.value : null))
    );

    // Prefer SaaS URL, then Supabase URL, then Drive webViewLink
    return saasUrl ?? supabaseUrl_result ?? driveUrl ?? null;
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

// analyzeFrames is imported from ./ai.js (SaaS proxy client).

// ─── SaaS LINE relay ──────────────────────────────────────────────────────────

async function sendViaSaas(text, imageUrl) {
  const { config } = await chrome.storage.local.get('config');
  const apiBase = (config?.apiBase ?? 'https://livewatch-psi.vercel.app').replace(/\/$/, '');
  const apiToken = config?.apiToken;
  if (!apiToken) {
    console.warn('[LiveWatch] no apiToken — LINE alert skipped (configure in Settings)');
    return { ok: false, error: 'not_connected' };
  }
  try {
    const res = await fetch(`${apiBase}/api/line/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, imageUrl }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => String(res.status));
      console.warn('[LiveWatch] SaaS LINE send failed:', res.status, detail);
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[LiveWatch] SaaS LINE network error:', e);
    return { ok: false, error: String(e) };
  }
}

async function sendLineMessage(text) {
  const result = await sendViaSaas(text, null);
  return result.ok;
}

async function sendCaptureAlert(scores, capturedAt, thumbnailUrl) {
  const timeStr = new Date(capturedAt).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit',
  });

  const bar = (score) => {
    const filled = Math.round((score / 100) * 5);
    return '█'.repeat(filled) + '░'.repeat(5 - filled) + ` ${score}`;
  };

  // Read current live stats (viewer count + GMV) from storage
  const { lastStats } = await chrome.storage.local.get('lastStats');
  const viewerStr = lastStats?.viewer_count != null
    ? `👥 ผู้ชม: ${lastStats.viewer_count.toLocaleString()} คน`
    : null;
  const gmvStr = lastStats?.gmv != null
    ? `💰 GMV: ${lastStats.gmv}`
    : null;

  const lines = [
    scores.alert_flag ? `⚠️ แจ้งเตือน!` : `✅ ปกติ`,
    `📸 ผลวิเคราะห์ไลฟ์ (${timeStr} น.)`,
    viewerStr,
    gmvStr,
    ``,
    `🎭 อารมณ์      ${bar(scores.smile_score        ?? 0)}`,
    `👁 มองกล้อง   ${bar(scores.eye_contact_score   ?? 0)}`,
    `⚡ พลังงาน    ${bar(scores.energy_level         ?? 0)}`,
    `🎯 Engage     ${bar(scores.engagement_score     ?? 0)}`,
    `💡 แสง        ${bar(scores.lighting_quality     ?? 0)}`,
    ``,
    scores.phone_detected     ? `📱 ⚠️ ถือมือถือ!`    : `📱 ไม่ถือมือถือ`,
    scores.product_presenting ? `📦 กำลังเสนอสินค้า`  : `📦 ยังไม่เสนอสินค้า`,
  ].filter(Boolean);

  if (scores.activity_summary) {
    lines.push(``, `💬 ${scores.activity_summary}`);
  }

  await sendViaSaas(lines.join('\n'), thumbnailUrl ?? null);
}

// ─── LINE daily summary ───────────────────────────────────────────────────────

async function sendDailySummary() {
  try {
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

    // Collect unique thumbnail URLs (skip nulls); use first as image
    const imageUrls = [...new Set(
      hourly.map(c => c.thumbnail_url).filter(Boolean)
    )];

    const result = await sendViaSaas(summary, imageUrls[0] ?? null);
    if (result.ok) {
      log.info(`[LiveWatch] Hourly report sent via SaaS (${count} captures)`);
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

    const { data, error } = await saasPost('/api/sessions', sessionRow);

    if (error && error !== 'no_token') {
      log.error('[LiveWatch] startSession SaaS insert failed:', error);
    }

    // Use SaaS-assigned ID if available, otherwise generate a local UUID
    // so the extension can still track sessions without a backend.
    const sessionId = data?.id ?? crypto.randomUUID();

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

    const { error: endError } = await saasPatch(`/api/sessions/${sessionId}`, {
      ended_at: endedAt,
      duration_mins: durationMins,
    });
    if (endError && endError !== 'no_token') {
      log.error('[LiveWatch] endSession SaaS update failed:', endError);
    }

    // Dual-write session end to Google Sheets (fire-and-forget)
    sheetsWrite('sessions', {
      id: sessionId,
      ended_at: endedAt,
      duration_mins: durationMins,
    }).catch((e) => log.warn('[LiveWatch] Sheets write failed:', e));

    // Clear lastBurstAt so the next session's first burst is not suppressed
    // by stale timing from this session (Bug fix: P1).
    await chrome.storage.local.remove('lastBurstAt');
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
      // Verify a live video actually exists before going to MONITORING.
      // The URL alone matches the streamer dashboard even when not live.
      const hasVideo = await new Promise((resolve) => {
        chrome.tabs.sendMessage(liveTab.id, { type: 'PING' }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            resolve(false);
            return;
          }
          // PING succeeded — content script is running, but ask if video exists
          chrome.tabs.sendMessage(liveTab.id, { type: 'CHECK_VIDEO' }, (vRes) => {
            resolve(!chrome.runtime.lastError && vRes?.hasVideo === true);
          });
        });
      });

      if (hasVideo) {
        if (state.liveTabId !== liveTab.id || state.status === STATUS.OFFLINE) {
          await setLiveTab(liveTab.id);
        }
      } else if (state.status !== STATUS.OFFLINE && state.liveTabId === liveTab.id) {
        // Tab exists but no live video — go offline
        await goOffline();
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

async function triggerBurst({ force = false } = {}) {
  if (!state.liveTabId || state.status === STATUS.OFFLINE) return;

  // Don't interrupt an in-progress capture/analyze cycle
  if (state.status === STATUS.CAPTURING || state.status === STATUS.ANALYZING) {
    log.warn('[LiveWatch] triggerBurst: already in progress, skipping');
    return;
  }

  // Tier floor: enforce minimum gap between bursts (fail-safe to gold).
  // Skipped when force=true (manual test burst).
  if (!force) {
    try {
      const tierLimits = await getCachedTier();
      const { lastBurstAt = 0 } = await chrome.storage.local.get('lastBurstAt');
      const minGapMs = tierLimits.minIntervalMinutes * 60 * 1000;
      if (Date.now() - lastBurstAt < minGapMs) {
        console.warn('[LiveWatch] tier floor: burst suppressed, too soon');
        return;
      }
    } catch (e) {
      log.warn('[LiveWatch] tier floor check failed:', e?.message);
    }
  }

  try {
    await chrome.storage.local.set({ lastBurstAt: Date.now() });
  } catch (e) {
    log.warn('[LiveWatch] lastBurstAt save failed:', e?.message);
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

  // Upload thumbnail first so the URL can be forwarded to the AI analyze call
  const thumbnailUrl = response.frames?.[0]
    ? await uploadThumbnail(response.frames[0], state.sessionId, capturedAt)
    : null;

  log.info(`[LiveWatch] analyzeFrames: sending ${response.frames.length} frames to SaaS proxy...`);
  const scores = await analyzeFrames(response.frames, {
    session_id:    state.sessionId ?? undefined,
    captured_at:   capturedAt,
    thumbnail_url: thumbnailUrl ?? undefined,
  });
  log.info('[LiveWatch] analyzeFrames result:', scores);

  if (!scores) {
    await chrome.storage.local.set({
      lastCaptureStatus: { step: 'error', message: 'AI วิเคราะห์ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อบัญชี LiveWatch', at: capturedAt },
    });
  }

  if (scores) {
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
      session_id:         state.sessionId,
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
            await finalizeSession(s.sessionId, {});
            await goOffline();
          }
        }
      }
    } else if (alarm.name === 'chatBatch') {
      await loadState();
      if (state.sessionId) {
        await flushChatBuffer(state.sessionId);
        await runChatSentimentBatch(state.sessionId, {});
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
            await finalizeSession(s.sessionId, {});
          }
        } catch (e) {
          log.error('[LiveWatch] LIVE_ENDED finalizeSession error:', e);
        }
        await goOffline();
        // Best-effort analytics scrape after session ends
        if (s.sessionId) {
          scheduleAnalyticsScrape(s.sessionId).catch((e) =>
            log.warn('[LiveWatch] LIVE_ENDED analytics scrape error:', e)
          );
        }
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
      // Manual trigger for testing — force=true bypasses tier floor
      triggerBurst({ force: true })
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

// ─── External message handler (web page → extension token handoff) ──────────

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const senderOrigin = sender?.url ? (() => { try { return new URL(sender.url).origin; } catch { return ''; } })() : '';
  const isAllowed =
    senderOrigin === 'https://livewatch-psi.vercel.app' ||
    senderOrigin === 'http://localhost:3000' ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(senderOrigin);

  if (!isAllowed) {
    console.warn('[LiveWatch] rejected external message from', senderOrigin);
    sendResponse({ ok: false, error: 'origin not allowed' });
    return;
  }

  if (message?.type === 'SET_API_TOKEN' && typeof message.token === 'string' && message.token.startsWith('lw_')) {
    (async () => {
      try {
        const { config = {} } = await chrome.storage.local.get('config');
        const apiBase = (message.apiBase ?? config.apiBase ?? 'https://livewatch-psi.vercel.app').replace(/\/$/, '');
        await chrome.storage.local.set({
          config: { ...config, apiBase, apiToken: message.token },
        });
        try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}

        try {
          const res = await fetch(`${apiBase}/api/user/tier`, {
            headers: { Authorization: `Bearer ${message.token}` },
          });
          if (res.ok) {
            const tier = await res.json();
            await chrome.storage.local.set({
              userTier: {
                tier: tier.tier,
                maxPerHour: tier.maxCapturesPerHour,
                minIntervalMinutes: tier.minIntervalMinutes,
                fetchedAt: Date.now(),
              },
            });
          }
        } catch (e) {
          console.warn('[LiveWatch] tier fetch after SET_API_TOKEN failed:', e);
        }

        sendResponse({ ok: true });
      } catch (e) {
        console.error('[LiveWatch] SET_API_TOKEN handler error:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  sendResponse({ ok: false, error: 'unknown message type' });
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
    // Detect legacy LINE config and nudge user to reconnect via SaaS
    chrome.storage.local.get(['config', 'lineToken', 'lineUserId', 'pollinationsKey', 'supabaseUrl', 'supabaseKey']).then((items) => {
      const cfg = items.config ?? {};
      if (cfg.lineToken || cfg.lineUserId || items.lineToken || items.lineUserId) {
        console.warn('[LiveWatch] legacy LINE config detected — please connect via Settings → LiveWatch Account');
        try {
          chrome.action.setBadgeText({ text: 'CFG' });
          chrome.action.setBadgeBackgroundColor({ color: '#FFA500' });
        } catch (_) {}
      }
      if (cfg?.pollinationsKey || cfg?.supabaseUrl || cfg?.supabaseKey || items.pollinationsKey || items.supabaseUrl || items.supabaseKey) {
        console.info('[LiveWatch] legacy AI/Supabase config detected — these are now handled by the SaaS backend. You can ignore.');
      }
    }).catch(() => {});
  }
  // On first install, open the consent/onboarding page.
  if (details?.reason === 'install') {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/welcome.html') });
    } catch (e) {
      log.error('[LiveWatch] open onboarding error:', e);
    }
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
