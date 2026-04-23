/**
 * content_workbench.js — TikTok Shop Workbench scraper (LiveWatch)
 * Injected into: shop.tiktok.com/workbench/live/*
 *
 * This script is a SEPARATE code path from src/content.js.  DO NOT mix its
 * output with the legacy `/streamer/live/*` scraper.  The workbench page
 * surfaces a richer analytics dashboard (traffic sources, product table,
 * demographics, etc.) and updates on a slow cadence (~minutes), so we poll
 * every 30 s and write to a dedicated storage key `workbenchStats`.
 *
 * ---------------------------------------------------------------------------
 * Selector strategy (ordered by robustness)
 * ---------------------------------------------------------------------------
 *  1. Text-first traversal — locate a Thai label node (e.g. "ยอดเข้าชม"),
 *     walk up to a small container, read the sibling/child numeric node.
 *     This is resilient to TikTok's CSS-module hash churn.
 *  2. Structural table scraping — the per-product table is read via
 *     <table>/<thead>/<tbody> semantics, with header-text mapping.
 *  3. URL query parameter for room_id (trusted).
 *
 * ---------------------------------------------------------------------------
 * Known risks / to-validate-during-live-session
 * ---------------------------------------------------------------------------
 *  - Thai label strings are taken from a sample scan — TikTok may pluralise,
 *    abbreviate, or swap synonyms (e.g. "ยอดวิว" vs "ยอดการแสดงผล").  Every
 *    label pattern is a regex to tolerate small wording drift.
 *  - Per-card value sibling may be one-deep or two-deep; we search the
 *    nearest ancestor with a reasonable character count.
 *  - Traffic-source block has 11 rows × 3 percentages; we detect it by
 *    scanning for "แหล่งที่มาของทราฟฟิก" (or EN fallback) and reading the
 *    sibling grid as rows.
 *  - Demographics block (gender × age × province) — depends on text
 *    landmarks "เพศ", "อายุ", "จังหวัด".  If the dashboard renders charts
 *    without accessible text, these fields will be null.
 *  - Historical replay vs live: we check for a live indicator badge + the
 *    video element's `duration`.  Finite duration + no LIVE badge => replay.
 *
 * ALL extraction is wrapped in try/catch.  Missing fields become null — the
 * scraper MUST NOT throw or block the page.
 */

'use strict';

if (window.__livewatchWorkbenchLoaded) {
  // Already injected — no-op.
} else {
window.__livewatchWorkbenchLoaded = true;

// ---------------------------------------------------------------------------
// Constants (inlined — content scripts cannot import ES modules)
// ---------------------------------------------------------------------------

const MSG = {
  WORKBENCH_STATS_UPDATE: 'WORKBENCH_STATS_UPDATE',
  WORKBENCH_HEARTBEAT:    'WORKBENCH_HEARTBEAT',
};

const POLL_INTERVAL_MS      = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STORAGE_KEY           = 'workbenchStats';

// Thai + English label patterns for each scalar field.
// First match wins.  Patterns are case-insensitive and use boundary-ish
// lookarounds where possible to avoid matching sub-words.
const LABEL_PATTERNS = {
  gmv:              /^\s*GMV\b|^\s*GMV\s*\(/i,
  unitsSold:        /สินค้าที่ขายได้|units?\s*sold/i,
  viewers:          /^\s*ผู้ชม\s*$|^\s*viewers?\s*$|จำนวนผู้ชม/i,
  impressions:      /ยอดการแสดงผล|impressions?/i,
  visits:           /ยอดเข้าชม|visits?/i,
  gmvPerHour:       /GMV\s*ต่อ\s*ชั่วโมง|GMV\s*\/\s*hour|GMV\s*per\s*hour/i,
  showGpm:          /Show\s*GPM/i,
  avgWatchSeconds:  /ระยะเวลาในการดูเฉลี่ย|avg.*watch.*duration|average.*watch/i,
  ctr:              /^\s*CTR\s*$|อัตราการคลิกผ่าน/i,
  liveCtr:          /CTR\s*\(\s*LIVE/i,
  orderRate:        /อัตรา.*สั่งซื้อ|order\s*rate/i,
  likeRate:         /อัตรา.*ถูกใจ|like\s*rate/i,
  followRate:       /อัตรา.*ติดตาม|follow\s*rate/i,
  commentRate:      /อัตรา.*คอมเมนต์|comment\s*rate/i,
  viewsOver1Min:    /ดู\s*>\s*1\s*นาที|views?\s*>\s*1\s*min/i,
  adCost:           /ต้นทุนโฆษณา|ad\s*cost|ad\s*spend/i,
  duration:         /^\s*ระยะเวลา\s*$|^\s*duration\s*$/i,
};

// Traffic-source channel labels (11 expected).  Mapped to canonical keys.
const TRAFFIC_CHANNEL_PATTERNS = [
  /หน้า.*สำหรับคุณ|for\s*you/i,
  /ติดตาม|following/i,
  /โปรไฟล์|profile/i,
  /ค้นหา|search/i,
  /ประกาศ|announcement|notification/i,
  /ข้อความ|message|inbox/i,
  /แชร์|share/i,
  /โฆษณา|ads?/i,
  /LIVE|ไลฟ์/i,
  /ร้านค้า|shop/i,
  /อื่น\s*ๆ|other/i,
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof setInterval>|null} */
let pollTimer      = null;
/** @type {ReturnType<typeof setInterval>|null} */
let heartbeatTimer = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Parse a numeric string that may include ฿, commas, %, K/M suffixes.
 * Returns null for "-", "--", empty, or unparseable input.
 *
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
function parseNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[฿,\s]/g, '').replace(/%$/, '').trim();
  if (s === '' || s === '-' || s === '--') return null;

  const upper = s.toUpperCase();
  if (upper.endsWith('M')) {
    const n = parseFloat(upper.slice(0, -1));
    return Number.isNaN(n) ? null : n * 1_000_000;
  }
  if (upper.endsWith('K')) {
    const n = parseFloat(upper.slice(0, -1));
    return Number.isNaN(n) ? null : n * 1_000;
  }

  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse a percentage string ("12.3%" → 12.3).  Returns null on failure.
 *
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
function parsePercent(raw) {
  if (raw == null) return null;
  const match = String(raw).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse a duration string ("1:23:45" or "1h 23m" or "90s") into seconds.
 * Returns null on failure.
 *
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
function parseDurationSeconds(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // HH:MM:SS / MM:SS
  if (/^\d+(?::\d{1,2}){1,2}$/.test(s)) {
    const parts = s.split(':').map(Number);
    if (parts.some(Number.isNaN)) return null;
    let seconds = 0;
    for (const p of parts) seconds = seconds * 60 + p;
    return seconds;
  }

  // "1h 2m 3s" / "1 ชม. 2 นาที"
  let total = 0;
  let matched = false;
  const h = s.match(/(\d+)\s*(?:h|hr|hour|ชั่วโมง|ชม\.?)/i);
  const m = s.match(/(\d+)\s*(?:m|min|minute|นาที)/i);
  const sec = s.match(/(\d+)\s*(?:s|sec|second|วินาที)/i);
  if (h) { total += parseInt(h[1], 10) * 3600; matched = true; }
  if (m) { total += parseInt(m[1], 10) * 60;   matched = true; }
  if (sec) { total += parseInt(sec[1], 10);    matched = true; }
  if (matched) return total;

  // Plain number — assume seconds
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Extract the room_id query parameter from the current URL.
 * @returns {string|null}
 */
function getRoomId() {
  try {
    const url = new URL(location.href);
    return url.searchParams.get('room_id') ?? null;
  } catch (_err) {
    return null;
  }
}

/**
 * Fire-and-forget chrome.runtime.sendMessage wrapper.
 * @param {object} message
 */
function sendToBackground(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch (err) {
    console.warn('[LiveWatch/Workbench] sendToBackground failed:', err?.message);
    stopTimers();
  }
}

// ---------------------------------------------------------------------------
// Text-based label → value lookup
// ---------------------------------------------------------------------------

/**
 * Walk up from a text-bearing element to find a container that also holds
 * the matching numeric value.  We limit the walk to 4 ancestors to avoid
 * capturing the whole page.
 *
 * @param {Element} labelEl
 * @returns {string|null} Raw value text, or null if nothing found.
 */
function findValueNear(labelEl) {
  let node = labelEl;
  for (let depth = 0; depth < 4 && node; depth++) {
    const parent = node.parentElement;
    if (!parent) break;

    // Look at sibling text within this container — prefer elements whose
    // text looks "value-ish" (contains a digit and is short).
    const candidates = parent.querySelectorAll('*');
    for (const c of candidates) {
      if (c === labelEl || c.contains(labelEl) || labelEl.contains(c)) continue;
      const t = (c.innerText || '').trim();
      if (!t || t.length > 40) continue;
      if (!/\d/.test(t)) continue;
      // Reject if it's itself another label
      if (Object.values(LABEL_PATTERNS).some((re) => re.test(t))) continue;
      return t;
    }
    node = parent;
  }
  return null;
}

/**
 * Find the raw value text for a given label regex by scanning all small
 * text nodes in the document.
 *
 * @param {RegExp} pattern
 * @returns {string|null}
 */
function findRawByLabel(pattern) {
  try {
    // Narrow the search: only scan small-ish text elements.
    const all = document.querySelectorAll('span, div, p, label, td, th');
    for (const el of all) {
      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length > 60) continue;
      if (!pattern.test(text)) continue;

      const value = findValueNear(el);
      if (value != null) return value;
    }
  } catch (err) {
    console.warn('[LiveWatch/Workbench] findRawByLabel error:', err?.message);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scalar extraction
// ---------------------------------------------------------------------------

/**
 * Extract all scalar metric fields.  Each field is parsed to number where
 * appropriate; missing fields stay null.
 *
 * @returns {object}
 */
function extractScalars() {
  /** @type {Record<string, string|null>} */
  const raw = {};
  for (const [key, pattern] of Object.entries(LABEL_PATTERNS)) {
    raw[key] = findRawByLabel(pattern);
  }

  return {
    gmv:             { value: parseNumber(raw.gmv), currency: 'THB' },
    unitsSold:       parseNumber(raw.unitsSold),
    viewers:         parseNumber(raw.viewers),
    impressions:     parseNumber(raw.impressions),
    visits:          parseNumber(raw.visits),
    gmvPerHour:      parseNumber(raw.gmvPerHour),
    showGpm:         parseNumber(raw.showGpm),
    avgWatchSeconds: parseDurationSeconds(raw.avgWatchSeconds) ?? parseNumber(raw.avgWatchSeconds),
    ctr:             parsePercent(raw.ctr),
    liveCtr:         parsePercent(raw.liveCtr),
    orderRate:       parsePercent(raw.orderRate),
    likeRate:        parsePercent(raw.likeRate),
    followRate:      parsePercent(raw.followRate),
    commentRate:     parsePercent(raw.commentRate),
    viewsOver1Min:   parseNumber(raw.viewsOver1Min),
    adCost:          parseNumber(raw.adCost),
    durationSeconds: parseDurationSeconds(raw.duration),
  };
}

// ---------------------------------------------------------------------------
// Live start / end timestamps
// ---------------------------------------------------------------------------

/**
 * Heuristic: look for two ISO-ish or "YYYY-MM-DD HH:MM" timestamps on the
 * page (start, end).  Return best guesses as ISO strings or null.
 *
 * @returns {{ liveStartAt: string|null, liveEndAt: string|null }}
 */
function extractTimestamps() {
  try {
    const text = document.body?.innerText ?? '';
    // Match patterns like "2026-04-24 14:23:01" or "2026/04/24 14:23"
    const pattern = /\b(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\b/g;
    const matches = text.match(pattern) ?? [];

    const unique = Array.from(new Set(matches));
    const toIso = (s) => {
      try {
        const normalised = s.replace(/\//g, '-').replace(' ', 'T');
        const d = new Date(normalised);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      } catch (_e) {
        return null;
      }
    };

    const [start, end] = unique;
    return {
      liveStartAt: start ? toIso(start) : null,
      liveEndAt:   end   ? toIso(end)   : null,
    };
  } catch (_err) {
    return { liveStartAt: null, liveEndAt: null };
  }
}

// ---------------------------------------------------------------------------
// Traffic source breakdown
// ---------------------------------------------------------------------------

/**
 * Find the container that houses the traffic-source table, then read rows.
 * Each row: channel name + 3 percentages (GMV%, impressions%, visits%).
 *
 * @returns {Array<object>}
 */
function extractTrafficSources() {
  try {
    // Locate section by Thai/EN heading.
    const heading = [...document.querySelectorAll('*')].find((el) => {
      const t = (el.innerText || '').trim();
      return t.length < 60 && /แหล่งที่มาของทราฟฟิก|traffic\s*source/i.test(t);
    });
    if (!heading) return [];

    // Walk upward until we find a container with a tabular layout.
    let container = heading.parentElement;
    let rows = [];
    for (let depth = 0; depth < 6 && container; depth++) {
      // Try table first.
      const table = container.querySelector('table');
      if (table) {
        rows = Array.from(table.querySelectorAll('tbody tr'));
        if (rows.length > 0) break;
      }
      // Otherwise look for a grid of rows — elements with at least 4 cells.
      const gridRows = Array.from(container.querySelectorAll('[role="row"], li, .row'))
        .filter((r) => {
          const text = (r.innerText || '').trim();
          return text && text.length < 200 && /%/.test(text);
        });
      if (gridRows.length >= 3) {
        rows = gridRows;
        break;
      }
      container = container.parentElement;
    }

    return rows.slice(0, 15).map((row) => {
      const cells = Array.from(row.querySelectorAll('td, [role="cell"], span, div'))
        .map((c) => (c.innerText || '').trim())
        .filter((t) => t.length > 0 && t.length < 60);

      if (cells.length === 0) return null;

      // Find channel (first non-numeric cell) and percentages.
      const channel = cells.find((c) => !/^\d/.test(c) && !/%$/.test(c)) ?? null;
      const percentCells = cells.filter((c) => /%/.test(c));

      return {
        channel,
        gmvPct:         parsePercent(percentCells[0]),
        impressionsPct: parsePercent(percentCells[1]),
        visitsPct:      parsePercent(percentCells[2]),
      };
    }).filter((r) => r !== null && r.channel != null);
  } catch (err) {
    console.warn('[LiveWatch/Workbench] extractTrafficSources error:', err?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Follower composition
// ---------------------------------------------------------------------------

/**
 * @returns {{ newFollowers: number|null, existing: number|null, nonFollower: number|null }}
 */
function extractFollowerBreakdown() {
  const newFollowers = parsePercent(findRawByLabel(/ผู้ติดตามใหม่|new\s*followers?/i));
  const existing     = parsePercent(findRawByLabel(/ผู้ติดตามเดิม|existing\s*followers?/i));
  const nonFollower  = parsePercent(findRawByLabel(/ไม่ใช่ผู้ติดตาม|non[-\s]?follower/i));
  return { newFollowers, existing, nonFollower };
}

// ---------------------------------------------------------------------------
// Per-product table
// ---------------------------------------------------------------------------

/**
 * Extract the per-product analytics table.
 * @returns {Array<object>}
 */
function extractProducts() {
  try {
    // Heuristic: find a <table> whose header contains "สินค้า" or "Product".
    const tables = Array.from(document.querySelectorAll('table'));
    const target = tables.find((t) => {
      const headerText = (t.querySelector('thead')?.innerText || t.querySelector('tr')?.innerText || '');
      return /สินค้า|product/i.test(headerText)
          && /(CTR|GMV|คลิก|impression|แสดงผล)/i.test(headerText);
    });

    if (!target) return [];

    const headers = Array.from(target.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td'))
      .map((c) => (c.innerText || '').trim());

    const colIndex = (patterns) => headers.findIndex((h) => patterns.some((p) => p.test(h)));

    const idxName        = colIndex([/สินค้า|product\s*name|name/i]);
    const idxImpressions = colIndex([/ยอดการแสดงผล|impression/i]);
    const idxCtr         = colIndex([/CTR/i]);
    const idxGmv         = colIndex([/GMV/i]);
    const idxCart        = colIndex([/หยิบใส่ตะกร้า|ใส่ตะกร้า|cart|add.*cart/i]);
    const idxStock       = colIndex([/คงเหลือ|stock|inventory/i]);

    const bodyRows = Array.from(target.querySelectorAll('tbody tr'));
    return bodyRows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').trim());
      if (cells.length === 0) return null;

      // Product ID: look for a long numeric substring in the name cell or a data attribute.
      const nameCell   = idxName   >= 0 ? cells[idxName]   : cells[0];
      const productIdMatch = (nameCell || '').match(/\b(\d{10,})\b/)
        || (tr.getAttribute('data-product-id') ? [null, tr.getAttribute('data-product-id')] : null);

      return {
        productId:   productIdMatch ? productIdMatch[1] : null,
        name:        nameCell || null,
        impressions: idxImpressions >= 0 ? parseNumber(cells[idxImpressions]) : null,
        ctr:         idxCtr         >= 0 ? parsePercent(cells[idxCtr])        : null,
        gmv:         idxGmv         >= 0 ? parseNumber(cells[idxGmv])         : null,
        cartAdds:    idxCart        >= 0 ? parseNumber(cells[idxCart])        : null,
        stock:       idxStock       >= 0 ? parseNumber(cells[idxStock])       : null,
      };
    }).filter((r) => r !== null);
  } catch (err) {
    console.warn('[LiveWatch/Workbench] extractProducts error:', err?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

/**
 * Extract gender/age/province breakdown.  All fields may be null.
 *
 * @returns {object}
 */
function extractDemographics() {
  try {
    const gender = {
      male:   parsePercent(findRawByLabel(/ชาย|^\s*male\s*$/i)),
      female: parsePercent(findRawByLabel(/หญิง|^\s*female\s*$/i)),
    };

    const ageBuckets = {
      '18-24': parsePercent(findRawByLabel(/18\s*[-–]\s*24/)),
      '25-34': parsePercent(findRawByLabel(/25\s*[-–]\s*34/)),
      'over34': parsePercent(findRawByLabel(/>\s*34|35\s*\+|มากกว่า\s*34/)),
    };

    // Top provinces — find the "จังหวัด" / "Province" heading and read below.
    const topProvinces = [];
    try {
      const heading = [...document.querySelectorAll('*')].find((el) => {
        const t = (el.innerText || '').trim();
        return t.length < 40 && /จังหวัด|province|region/i.test(t);
      });
      if (heading) {
        let container = heading.parentElement;
        for (let d = 0; d < 5 && container && topProvinces.length === 0; d++) {
          const rows = Array.from(container.querySelectorAll('li, [role="row"], tr, .row'));
          for (const row of rows.slice(0, 10)) {
            const text = (row.innerText || '').trim();
            if (!text || !/%/.test(text)) continue;
            const pctMatch = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
            const province = text.replace(/-?\d+(?:\.\d+)?\s*%/, '').trim();
            if (province && pctMatch) {
              topProvinces.push({ province, pct: parseFloat(pctMatch[1]) });
            }
            if (topProvinces.length >= 5) break;
          }
          container = container.parentElement;
        }
      }
    } catch (_e) { /* swallow */ }

    return { gender, ageBuckets, topProvinces };
  } catch (_err) {
    return { gender: {}, ageBuckets: {}, topProvinces: [] };
  }
}

// ---------------------------------------------------------------------------
// Historical / live detection
// ---------------------------------------------------------------------------

/**
 * Decide whether we're looking at an active live or a historical replay.
 * A live session typically has a "LIVE" badge and the <video> has
 * duration === Infinity (HLS).  Replays have a finite duration.
 *
 * @returns {boolean} true if this is a historical replay view
 */
function isHistorical() {
  try {
    const video = document.querySelector('video');
    if (video) {
      if (Number.isFinite(video.duration) && video.duration > 0) return true;
      if (video.duration === Infinity) return false;
    }

    // Text landmark: "ไลฟ์จบแล้ว" / "LIVE ended" → historical
    const bodyText = document.body?.innerText ?? '';
    if (/ไลฟ์จบแล้ว|live\s*ended|replay|บันทึก/i.test(bodyText)) return true;

    // Default: treat as historical (safer — no alerts)
    return true;
  } catch (_err) {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Top-level scrape
// ---------------------------------------------------------------------------

/**
 * Scrape the entire workbench dashboard into the canonical shape.
 * Wraps everything in try/catch; never throws.
 *
 * @returns {object}
 */
function scrapeWorkbench() {
  try {
    const scalars    = extractScalars();
    const timestamps = extractTimestamps();

    return {
      source:     'workbench',
      roomId:     getRoomId(),
      scrapedAt:  new Date().toISOString(),
      historical: isHistorical(),

      liveStartAt:     timestamps.liveStartAt,
      liveEndAt:       timestamps.liveEndAt,
      durationSeconds: scalars.durationSeconds,

      gmv:             scalars.gmv,
      unitsSold:       scalars.unitsSold,
      viewers:         scalars.viewers,
      impressions:     scalars.impressions,
      visits:          scalars.visits,
      gmvPerHour:      scalars.gmvPerHour,
      showGpm:         scalars.showGpm,
      avgWatchSeconds: scalars.avgWatchSeconds,
      ctr:             scalars.ctr,
      liveCtr:         scalars.liveCtr,
      orderRate:       scalars.orderRate,
      likeRate:        scalars.likeRate,
      followRate:      scalars.followRate,
      commentRate:     scalars.commentRate,
      viewsOver1Min:   scalars.viewsOver1Min,
      adCost:          scalars.adCost,

      trafficSources:    extractTrafficSources(),
      followerBreakdown: extractFollowerBreakdown(),
      products:          extractProducts(),
      demographics:      extractDemographics(),
    };
  } catch (err) {
    console.error('[LiveWatch/Workbench] scrapeWorkbench fatal:', err);
    return {
      source:     'workbench',
      roomId:     getRoomId(),
      scrapedAt:  new Date().toISOString(),
      historical: true,
      error:      String(err?.message ?? 'scrape_failed'),
    };
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

/**
 * Perform one scrape, write to chrome.storage.local, and notify background.
 */
function pollOnce() {
  const stats = scrapeWorkbench();

  try {
    chrome.storage.local.set({ [STORAGE_KEY]: stats }, () => {
      void chrome.runtime.lastError;
    });
  } catch (err) {
    console.warn('[LiveWatch/Workbench] storage.set failed:', err?.message);
  }

  sendToBackground({ type: MSG.WORKBENCH_STATS_UPDATE, stats });
}

function startPolling() {
  if (pollTimer !== null) return;
  // First scrape after a short delay so the page has time to render.
  setTimeout(pollOnce, 3_000);
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startHeartbeat() {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = setInterval(() => {
    sendToBackground({
      type:   MSG.WORKBENCH_HEARTBEAT,
      roomId: getRoomId(),
      url:    location.href,
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function stopTimers() {
  stopPolling();
  stopHeartbeat();
}

// ---------------------------------------------------------------------------
// Message listener (PING for background health-checks)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ ok: true, scope: 'workbench' });
    return false;
  }

  if (message?.type === 'WORKBENCH_SCRAPE_NOW') {
    try {
      const stats = scrapeWorkbench();
      sendResponse({ stats });
    } catch (err) {
      sendResponse({ error: String(err?.message ?? 'scrape_failed') });
    }
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Clean up on page unload so no dangling timers leak after SPA nav.
window.addEventListener('beforeunload', stopTimers, { once: true });

startHeartbeat();
startPolling();

console.info('[LiveWatch/Workbench] content_workbench.js initialised for', location.href);

} // end guard: window.__livewatchWorkbenchLoaded
