/**
 * session_summary.js — Phase 4: Session Summary for LiveWatch
 *
 * Computes and dispatches a Thai-language LINE message summarising
 * a completed TikTok Live session.
 *
 * ES module — imported by background.js (MV3 service worker, type: module).
 * All flags that must survive service-worker restarts are persisted to
 * chrome.storage.local.
 */

import { supabaseUpdate } from './supabase.js';
import { sendLineMessage } from './line.js';

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Convert satang (integer) to a formatted Thai baht string.
 * Returns "ไม่มีข้อมูล" for null/undefined.
 *
 * @param {number|null|undefined} satang
 * @returns {string}
 */
function formatGmv(satang) {
  if (satang == null) return 'ไม่มีข้อมูล';
  const baht = satang / 100;
  // toLocaleString gives comma-separated thousands with 2 decimals
  const formatted = baht.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `฿${formatted}`;
}

/**
 * Parse a Thai baht string (e.g. "฿1,234.56") into integer satang (× 100).
 * Returns null for null/undefined/unparseable input.
 *
 * @param {string|null|undefined} str
 * @returns {number|null}
 */
function parseBahtToSatang(str) {
  if (str == null) return null;
  const cleaned = String(str).replace(/฿/g, '').replace(/,/g, '').trim();
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return null;
  return Math.round(parsed * 100);
}

/**
 * Return the mean of numeric values in an array, rounded to 1 decimal.
 * Null/undefined values are filtered out.
 * Returns null if the filtered array is empty.
 *
 * @param {Array<number|null|undefined>} arr
 * @returns {number|null}
 */
function average(arr) {
  const valid = (arr ?? []).filter((v) => v != null && !isNaN(v));
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, v) => acc + v, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

/**
 * Format total minutes into Thai-style "X ชั่วโมง Y นาที" string.
 * Matches the formatDuration helper in line.js exactly.
 *
 * @param {number} totalMins
 * @returns {string}
 */
function formatDuration(totalMins) {
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours === 0) return `${mins} นาที`;
  if (mins === 0) return `${hours} ชั่วโมง`;
  return `${hours} ชั่วโมง ${mins} นาที`;
}

/**
 * Format a Date into Thai short-month date + time string.
 * Example: "6 เม.ย. 14:32"
 * Matches the formatThaiDate helper style in line.js.
 *
 * @param {Date} [date]
 * @returns {string}
 */
function formatThaiDateTime(date = new Date()) {
  const THAI_MONTHS = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  const day = date.getDate();
  const month = THAI_MONTHS[date.getMonth()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a session summary object from local chrome.storage.local data.
 *
 * @param {string} sessionId
 * @param {object} config - Extension config (not used directly; credentials are
 *   read from chrome.storage.local by supabase.js and line.js internally)
 * @returns {Promise<object>} summary object
 */
export async function buildSessionSummary(sessionId, config) {
  // 1. Read stats from local storage (statsBuffer) instead of Supabase.
  //    Post-SaaS migration: Supabase credentials are no longer stored locally,
  //    so we use the local statsBuffer that stats.js already maintains.
  const { statsBuffer } = await chrome.storage.local.get('statsBuffer');
  const timeline = Array.isArray(statsBuffer)
    ? statsBuffer.filter((r) => r.session_id === sessionId)
    : [];

  // 2. Read AI analysis results from local storage (recentCaptures)
  //    instead of querying analysis_logs in Supabase.
  const { recentCaptures } = await chrome.storage.local.get('recentCaptures');
  const logs = Array.isArray(recentCaptures)
    ? recentCaptures.filter((r) => r.session_id === sessionId)
    : [];

  // 3. Read lastChatSentiment from chrome.storage.local
  const { lastChatSentiment } = await chrome.storage.local.get('lastChatSentiment');
  const chatSentiment = lastChatSentiment ?? null;

  // 4. Read extensionState for session start time / duration
  const { extensionState } = await chrome.storage.local.get('extensionState');
  const sessionStartedAt = extensionState?.sessionStartedAt ?? null;
  let durationMins = 0;
  if (sessionStartedAt) {
    durationMins = Math.round(
      (Date.now() - new Date(sessionStartedAt).getTime()) / 60000
    );
  }

  // 5. Compute aggregate values
  const viewerCounts = timeline
    .map((r) => r.viewer_count)
    .filter((v) => v != null);
  const peak_viewers = viewerCounts.length > 0 ? Math.max(...viewerCounts) : null;

  // statsBuffer entries store raw `gmv` string (e.g. "฿1,234.56") from the
  // content script. Parse each entry — fall back to pre-converted gmv_satang
  // if present (future-proof for direct DB reads).
  const gmvValues = timeline
    .map((r) => r.gmv_satang ?? parseBahtToSatang(r.gmv))
    .filter((v) => v != null);
  const final_gmv_satang = gmvValues.length > 0 ? gmvValues[gmvValues.length - 1] : null;

  const unitValues = timeline
    .map((r) => r.units_sold)
    .filter((v) => v != null);
  const final_units_sold = unitValues.length > 0 ? unitValues[unitValues.length - 1] : null;

  const avg_smile_score = average(logs.map((l) => l.smile_score));
  const avg_eye_contact = average(logs.map((l) => l.eye_contact_score));
  const alert_count = logs.filter((l) => l.alert_flag === true).length;
  const phone_incidents = logs.filter((l) => l.phone_detected === true).length;
  const total_bursts = logs.length;

  // 6. Return summary object
  return {
    sessionId,
    sessionStartedAt,
    durationMins,
    peak_viewers,
    final_gmv_satang,
    final_units_sold,
    avg_smile_score,
    avg_eye_contact,
    alert_count,
    phone_incidents,
    total_bursts,
    chatSentiment,
  };
}

/**
 * Format and send a Thai-language LINE message summarising the ended session.
 *
 * @param {object} summary - Output of buildSessionSummary()
 * @param {object} config
 * @returns {Promise<void>}
 */
export async function sendSessionSummaryToLine(summary, config) {
  try {
    const now = new Date();
    const dateTimeStr = formatThaiDateTime(now);
    const durationStr = formatDuration(summary.durationMins ?? 0);

    const peakViewersStr = summary.peak_viewers != null
      ? `${summary.peak_viewers} คน`
      : 'ไม่มีข้อมูล';

    const gmvStr = formatGmv(summary.final_gmv_satang);

    const unitsSoldStr = summary.final_units_sold != null
      ? `${summary.final_units_sold} ชิ้น`
      : 'ไม่มีข้อมูล';

    const sentimentStr = summary.avg_smile_score != null
      ? `${summary.avg_smile_score}/100`
      : 'ไม่มีข้อมูล';

    const eyeStr = summary.avg_eye_contact != null
      ? `${summary.avg_eye_contact}/100`
      : 'ไม่มีข้อมูล';

    const lines = [
      `🎬 สรุปไลฟ์จบแล้ว!`,
      `📅 ${dateTimeStr}`,
      ``,
      `⏱ ระยะเวลา: ${durationStr}`,
      `👥 ผู้ชมสูงสุด: ${peakViewersStr}`,
      `💰 GMV รวม: ${gmvStr}`,
      `📦 ยอดขาย: ${unitsSoldStr}`,
      ``,
      `🎭 อารมณ์เฉลี่ย: ${sentimentStr}`,
      `👁 มองกล้องเฉลี่ย: ${eyeStr}`,
      `📱 จับมือถือ: ${summary.phone_incidents} ครั้ง`,
      `⚠️ แจ้งเตือน: ${summary.alert_count} ครั้ง (${summary.total_bursts} รอบทั้งหมด)`,
    ];

    if (summary.chatSentiment != null) {
      lines.push(``);
      lines.push(`💬 สรุปแชท:`);
      if (summary.chatSentiment.sentiment_score != null) {
        lines.push(`  sentiment: ${summary.chatSentiment.sentiment_score}/100`);
      }
      if (summary.chatSentiment.purchase_intent_count != null) {
        lines.push(`  purchase intent: ${summary.chatSentiment.purchase_intent_count} ข้อความ`);
      }
      if (summary.chatSentiment.suggested_action) {
        lines.push(`  แนะนำ: ${summary.chatSentiment.suggested_action}`);
      }
    }

    const text = lines.join('\n');

    const result = await sendLineMessage(text);
    if (!result.ok) {
      console.warn('[LiveWatch] sendSessionSummaryToLine: LINE not configured or send failed:', result.error);
    }
  } catch (e) {
    console.error('[LiveWatch] sendSessionSummaryToLine error:', e);
  }
}

/**
 * Finalize a live session: build summary, send LINE message, update Supabase,
 * and persist summary to chrome.storage.local.
 *
 * Guards against double-finalization using the 'endingSession' storage flag.
 * All errors are caught and logged — this function never throws.
 *
 * @param {string} sessionId
 * @param {object} config
 * @returns {Promise<void>}
 */
export async function finalizeSession(sessionId, config) {
  try {
    // 1. Guard: check if already being finalized for this sessionId
    const { endingSession } = await chrome.storage.local.get('endingSession');
    if (endingSession && endingSession.sessionId === sessionId) {
      console.info('[LiveWatch] finalizeSession: already finalizing session', sessionId, '— skipping');
      return;
    }

    // 2. Set endingSession flag (persisted so it survives service-worker restarts)
    await chrome.storage.local.set({
      endingSession: { sessionId, ts: Date.now() },
    });

    // 3. Build session summary
    let summary;
    try {
      summary = await buildSessionSummary(sessionId, config);
    } catch (e) {
      console.error('[LiveWatch] finalizeSession: buildSessionSummary error:', e);
      await chrome.storage.local.remove('endingSession');
      return;
    }

    // 4. Send LINE summary
    try {
      await sendSessionSummaryToLine(summary, config);
    } catch (e) {
      console.error('[LiveWatch] finalizeSession: sendSessionSummaryToLine error:', e);
      // Non-fatal — continue with Supabase update
    }

    // 5. Update sessions row in Supabase
    try {
      const { error: updateErr } = await supabaseUpdate(
        'sessions',
        { id: `eq.${sessionId}` },
        {
          room_status: 4,
          peak_viewers: summary.peak_viewers,
          final_gmv_satang: summary.final_gmv_satang,
          final_units_sold: summary.final_units_sold,
          line_summary_sent_at: new Date().toISOString(),
          chat_sentiment_summary: summary.chatSentiment,
        }
      );
      if (updateErr && !updateErr.includes('not configured')) {
        console.error('[LiveWatch] finalizeSession: supabaseUpdate error:', updateErr);
      }
    } catch (e) {
      console.error('[LiveWatch] finalizeSession: supabaseUpdate threw:', e);
    }

    // 6. Save summary to chrome.storage.local
    await chrome.storage.local.set({ sessionSummary: summary });

    // 7. Clear the endingSession flag
    await chrome.storage.local.remove('endingSession');

    console.info('[LiveWatch] finalizeSession: session', sessionId, 'finalized successfully');
  } catch (e) {
    console.error('[LiveWatch] finalizeSession error:', e);
    // Attempt to clear the flag so future calls are not permanently blocked
    try {
      await chrome.storage.local.remove('endingSession');
    } catch (_) { /* ignore */ }
  }
}
