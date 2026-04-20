/**
 * stats.js — Phase 3: Real-time Stats polling for LiveWatch
 *
 * Exports:
 *   scheduleStatsAlarm()  — create the 'statsPoll' alarm (every 30 s)
 *   clearStatsAlarm()     — clear the 'statsPoll' alarm
 *   handleStatsPoll()     — send POLL_STATS to content script, persist snapshot
 */

'use strict';

import { supabaseInsert } from './supabase.js';
import { getAuthToken, sheetsAppend } from './sheets.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALARM_STATS_POLL    = 'statsPoll';
const STATS_BUFFER_MAX    = 120;

// ─── Alarm helpers ────────────────────────────────────────────────────────────

/**
 * Create (or re-create) the stats-poll alarm that fires every 30 seconds.
 *
 * @returns {Promise<void>}
 */
export async function scheduleStatsAlarm() {
  try {
    await chrome.alarms.clear(ALARM_STATS_POLL);
    await chrome.alarms.create(ALARM_STATS_POLL, {
      periodInMinutes: 0.5, // 30 seconds
    });
    console.info('[LiveWatch] statsPoll alarm scheduled (every 30 s)');
  } catch (e) {
    console.error('[LiveWatch] scheduleStatsAlarm error:', e);
  }
}

/**
 * Clear the stats-poll alarm.
 *
 * @returns {Promise<void>}
 */
export async function clearStatsAlarm() {
  try {
    await chrome.alarms.clear(ALARM_STATS_POLL);
    console.info('[LiveWatch] statsPoll alarm cleared');
  } catch (e) {
    console.error('[LiveWatch] clearStatsAlarm error:', e);
  }
}

// ─── Stats poll handler ───────────────────────────────────────────────────────

/**
 * Send POLL_STATS to the content script in tabId, receive stats, persist them.
 * If stats.room_status === 4, writes a 'roomEnded' signal to chrome.storage.local.
 *
 * @param {number} tabId
 * @param {string} sessionId
 * @returns {Promise<object|null>} stats object or null on failure
 */
export async function handleStatsPoll(tabId, sessionId) {
  try {
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'POLL_STATS' }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[LiveWatch] handleStatsPoll sendMessage error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(res);
      });
    });

    if (!response || response.error) {
      console.warn('[LiveWatch] handleStatsPoll: bad response from content script:', response?.error ?? 'null');
      return null;
    }

    const stats = response.stats;
    if (!stats) {
      console.warn('[LiveWatch] handleStatsPoll: response missing stats field');
      return null;
    }

    // Persist snapshot to Supabase
    await persistStatSnapshot(sessionId, stats);

    // Update chrome.storage.local: lastStats and statsBuffer ring buffer
    const { statsBuffer = [] } = await chrome.storage.local.get('statsBuffer');
    const updatedBuffer = [...statsBuffer, { ...stats, session_id: sessionId }].slice(-STATS_BUFFER_MAX);

    const storageUpdate = {
      lastStats: stats,
      statsBuffer: updatedBuffer,
    };

    // Signal room ended if room_status === 4
    if (stats.room_status === 4) {
      storageUpdate.roomEnded = { sessionId, ts: Date.now() };
      console.info('[LiveWatch] handleStatsPoll: room_status 4 detected, writing roomEnded signal');
    }

    await chrome.storage.local.set(storageUpdate);

    return stats;
  } catch (e) {
    console.error('[LiveWatch] handleStatsPoll error:', e);
    return null;
  }
}

// ─── Google Sheets dual-write helper ─────────────────────────────────────────

/**
 * Fire-and-forget write to Google Sheets.
 * Silently skipped when Sheets is not configured or token is unavailable.
 *
 * @param {string} table - Sheet name
 * @param {Record<string, unknown>} row
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
    console.warn('[LiveWatch] sheetsWrite error:', e);
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Convert raw stats to DB row shape and insert into stats_timeline.
 *
 * Conversions:
 *   gmv_satang  — Thai baht string "฿1,234.56" → integer satang (× 100)
 *   ctr_bps     — percentage string "1.25%"    → basis points integer (× 100)
 *
 * @param {string} sessionId
 * @param {object} stats
 * @returns {Promise<void>}
 */
async function persistStatSnapshot(sessionId, stats) {
  try {
    const row = {
      session_id:     sessionId,
      captured_at:    stats.ts ?? new Date().toISOString(),
      viewer_count:   stats.viewer_count   ?? null,
      like_count:     stats.like_count     ?? null,
      room_status:    stats.room_status    ?? null,
      units_sold:     stats.units_sold     ?? null,
      product_clicks: stats.product_clicks ?? null,
      source:         stats.source         ?? null,
      gmv_satang:     parseBahtToSatang(stats.gmv),
      ctr_bps:        parsePercentToBps(stats.ctr),
    };

    const { error } = await supabaseInsert('stats_timeline', row);
    if (error && !error.includes('not configured')) {
      console.error('[LiveWatch] persistStatSnapshot insert error:', error);
    }

    // Dual-write to Google Sheets (fire-and-forget)
    sheetsWrite('stats_timeline', row).catch((e) =>
      console.warn('[LiveWatch] Sheets write failed:', e)
    );
  } catch (e) {
    console.error('[LiveWatch] persistStatSnapshot error:', e);
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

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
 * Parse a percentage string (e.g. "1.25%") into basis points integer (× 100).
 * Returns null for null/undefined/unparseable input.
 *
 * @param {string|null|undefined} str
 * @returns {number|null}
 */
function parsePercentToBps(str) {
  if (str == null) return null;
  const cleaned = String(str).replace(/%/g, '').trim();
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return null;
  return Math.round(parsed * 100);
}
