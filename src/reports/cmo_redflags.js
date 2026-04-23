/**
 * cmo_redflags.js — Wave 3 Executive Reporting
 *
 * Builds a Thai-language CMO Red-flags weekly LINE message.
 * Analyzes the last 7 days of execReports and surfaces actionable issues:
 *   - High-impression / low-conversion SKUs
 *   - Missed live slots in the "golden" time bucket
 *   - Ad spend efficiency decline (ROAS)
 *   - Presenter absence spikes
 *   - Quiet-minute spikes
 *   - Positive signals (best session, fastest-growing SKU)
 *
 * ES module — imported by background.js (MV3 service worker, type: module).
 * No runtime side-effects on import; all logic lives in exported functions.
 *
 * Minimum sample guards (to avoid false positives):
 *   - Timing gap check: requires >= 2 sessions in the historical window
 *   - ROAS trend check: requires >= 5 sessions total across the comparison windows
 */

import { sendLineMessage } from '../line.js';

// ─── Bangkok timezone offset (UTC+7) ─────────────────────────────────────────

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Return a Date representing "now" in Asia/Bangkok wall-clock time,
 * expressed as a UTC Date so getUTC* gives Bangkok values.
 *
 * @returns {Date}
 */
function nowBangkok() {
  return new Date(Date.now() + BANGKOK_OFFSET_MS);
}

// ─── Thai labels ──────────────────────────────────────────────────────────────

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const THAI_DOW_SHORT = [
  'อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.',
];

const HOUR_BUCKET_LABELS = [
  '00:00–06:00',
  '06:00–12:00',
  '12:00–18:00',
  '18:00–24:00',
];

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Format a Bangkok-adjusted Date as "พ. 6 เม.ย." (short DOW + day + month).
 *
 * @param {Date} bangkokDate
 * @returns {string}
 */
function formatThaiDateWithDow(bangkokDate) {
  const dow   = THAI_DOW_SHORT[bangkokDate.getUTCDay()];
  const day   = bangkokDate.getUTCDate();
  const month = THAI_MONTHS_SHORT[bangkokDate.getUTCMonth()];
  return `${dow} ${day} ${month}`;
}

/**
 * Format a Bangkok-adjusted Date as "6 เม.ย." (day + month, no DOW).
 *
 * @param {Date} bangkokDate
 * @returns {string}
 */
function formatThaiDate(bangkokDate) {
  const day   = bangkokDate.getUTCDate();
  const month = THAI_MONTHS_SHORT[bangkokDate.getUTCMonth()];
  return `${day} ${month}`;
}

/**
 * Format satang (integer cents) as Thai baht string "฿1,234.56".
 * Returns "ไม่มีข้อมูล" for null/undefined.
 *
 * @param {number|null|undefined} satang
 * @returns {string}
 */
function formatGmv(satang) {
  if (satang == null) return 'ไม่มีข้อมูล';
  const baht = satang / 100;
  return `฿${baht.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Normalize a SKU name for deduplication: lowercase + trim.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeSku(name) {
  return (name ?? '').toLowerCase().trim();
}

// ─── Window filter ────────────────────────────────────────────────────────────

/**
 * Filter execReports to records whose startTs falls within [nowMs - windowMs, nowMs].
 *
 * @param {Array<object>} records
 * @param {number} windowMs
 * @param {number} [nowMs]
 * @returns {Array<object>}
 */
function filterWindow(records, windowMs, nowMs = Date.now()) {
  const cutoff = nowMs - windowMs;
  return records.filter((r) => {
    const ts = typeof r.startTs === 'number' ? r.startTs : 0;
    return ts > cutoff && ts <= nowMs;
  });
}

// ─── Flag builders ────────────────────────────────────────────────────────────

/**
 * Flag 1: High-impression / low-conversion SKUs.
 *
 * Aggregates bottomSkus across this week's sessions.  Returns the top 5 SKUs
 * where total impressions >= 5000 AND total GMV == 0.
 *
 * @param {Array<object>} thisWeek
 * @returns {Array<{name:string, impressions:number}>}
 */
function flagHighImpressionNoSale(thisWeek) {
  /** @type {Map<string, {displayName:string, impressions:number, gmv:number}>} */
  const byKey = new Map();

  for (const r of thisWeek) {
    const skus = Array.isArray(r.bottomSkus) ? r.bottomSkus : [];
    for (const sku of skus) {
      if (!sku || !sku.name) continue;
      const key = normalizeSku(sku.name);
      const existing = byKey.get(key) ?? { displayName: sku.name, impressions: 0, gmv: 0 };
      byKey.set(key, {
        displayName: existing.displayName,
        impressions: existing.impressions + (sku.impressions ?? 0),
        gmv:         existing.gmv         + (sku.gmv         ?? 0),
      });
    }
  }

  return [...byKey.values()]
    .filter((s) => s.impressions >= 5000 && s.gmv === 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5)
    .map((s) => ({ name: s.displayName, impressions: s.impressions }));
}

/**
 * Flag 2: Missed live slots in the historically best hour bucket.
 *
 * Uses up to 30 days of historical data to determine the "golden bucket",
 * then checks the last 7 days: any calendar day missing a session in that bucket?
 *
 * Requires >= 2 sessions in the historical window; otherwise returns [].
 *
 * @param {Array<object>} last7Days    — sessions from the last 7 days
 * @param {Array<object>} last30Days   — sessions from the last 30 days (superset)
 * @returns {Array<{dateLabel:string, bucket:number}>}
 */
function flagMissedGoldenSlots(last7Days, last30Days) {
  if (last30Days.length < 2) return [];

  // Find best hour bucket by average GMV across the 30-day window
  const buckets = [
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
  ];

  for (const r of last30Days) {
    const b = typeof r.hourBucket === 'number' ? r.hourBucket : null;
    if (b == null || b < 0 || b > 3) continue;
    if (r.gmv == null) continue;
    buckets[b].sum   += r.gmv;
    buckets[b].count += 1;
  }

  let goldenBucket = null;
  let bestAvg = -Infinity;
  for (let i = 0; i < 4; i++) {
    if (buckets[i].count === 0) continue;
    const avg = buckets[i].sum / buckets[i].count;
    if (avg > bestAvg) {
      bestAvg = avg;
      goldenBucket = i;
    }
  }

  if (goldenBucket === null) return [];

  // Build a set of (bangkokDateStr, hourBucket) pairs covered by the last 7 days
  /** @type {Set<string>} key = "YYYY-MM-DD:bucket" */
  const covered = new Set();

  for (const r of last7Days) {
    const ts = typeof r.startTs === 'number' ? r.startTs : null;
    if (ts == null) continue;
    const bkk = new Date(ts + BANGKOK_OFFSET_MS);
    const dateStr = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, '0')}-${String(bkk.getUTCDate()).padStart(2, '0')}`;
    const b = typeof r.hourBucket === 'number' ? r.hourBucket : null;
    if (b != null) covered.add(`${dateStr}:${b}`);
  }

  // Check each of the 7 calendar days (Bangkok)
  const nowMs = Date.now();
  const missing = [];

  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const bkk = new Date(nowMs + BANGKOK_OFFSET_MS - daysBack * 24 * 60 * 60 * 1000);
    bkk.setUTCHours(0, 0, 0, 0);
    const dateStr = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, '0')}-${String(bkk.getUTCDate()).padStart(2, '0')}`;

    if (!covered.has(`${dateStr}:${goldenBucket}`)) {
      missing.push({
        dateLabel: formatThaiDateWithDow(bkk),
        bucket:    goldenBucket,
      });
    }
  }

  return missing;
}

/**
 * Flag 3: Ad spend efficiency (ROAS) decline.
 *
 * Compares this week's average ROAS to the previous 4 weeks' average.
 * Skips gracefully if all adSpend values are null, or if the total session
 * count across both windows is < 5.
 *
 * @param {Array<object>} thisWeek        — last 7 days
 * @param {Array<object>} prev4Weeks      — days 8–35 (exclusive of thisWeek)
 * @returns {{ declined: boolean, thisRoas: number|null, prevRoas: number|null, dropPct: number|null }}
 */
function flagRoasDecline(thisWeek, prev4Weeks) {
  const totalSessions = thisWeek.length + prev4Weeks.length;
  if (totalSessions < 5) {
    return { declined: false, thisRoas: null, prevRoas: null, dropPct: null };
  }

  /**
   * Compute average ROAS from an array of sessions.
   * Returns null if no sessions have non-null adSpend > 0.
   *
   * @param {Array<object>} records
   * @returns {number|null}
   */
  function avgRoas(records) {
    const valid = records.filter(
      (r) => r.adSpend != null && r.adSpend > 0 && r.gmv != null
    );
    if (valid.length === 0) return null;
    const totalRoas = valid.reduce((acc, r) => acc + r.gmv / r.adSpend, 0);
    return totalRoas / valid.length;
  }

  const thisRoas = avgRoas(thisWeek);
  const prevRoas = avgRoas(prev4Weeks);

  if (thisRoas == null || prevRoas == null || prevRoas === 0) {
    return { declined: false, thisRoas, prevRoas, dropPct: null };
  }

  const dropPct = ((prevRoas - thisRoas) / prevRoas) * 100;
  return {
    declined: dropPct >= 25,
    thisRoas,
    prevRoas,
    dropPct: dropPct > 0 ? dropPct : null,
  };
}

/**
 * Flag 4: Sessions with presenter absence spikes (presenterAbsentCount >= 3).
 *
 * @param {Array<object>} thisWeek
 * @returns {Array<{dateLabel:string, count:number}>}
 */
function flagPresenterAbsence(thisWeek) {
  return thisWeek
    .filter((r) => typeof r.presenterAbsentCount === 'number' && r.presenterAbsentCount >= 3)
    .map((r) => {
      const ts = typeof r.startTs === 'number' ? r.startTs : null;
      const dateLabel = ts != null
        ? formatThaiDateWithDow(new Date(ts + BANGKOK_OFFSET_MS))
        : (r.date ?? 'ไม่ทราบวัน');
      return { dateLabel, count: r.presenterAbsentCount };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Flag 5: Sessions with quiet-minute spikes (quietMinutes >= 10).
 *
 * @param {Array<object>} thisWeek
 * @returns {Array<{dateLabel:string, quietMinutes:number}>}
 */
function flagQuietMinutes(thisWeek) {
  return thisWeek
    .filter((r) => typeof r.quietMinutes === 'number' && r.quietMinutes >= 10)
    .map((r) => {
      const ts = typeof r.startTs === 'number' ? r.startTs : null;
      const dateLabel = ts != null
        ? formatThaiDateWithDow(new Date(ts + BANGKOK_OFFSET_MS))
        : (r.date ?? 'ไม่ทราบวัน');
      return { dateLabel, quietMinutes: r.quietMinutes };
    })
    .sort((a, b) => b.quietMinutes - a.quietMinutes);
}

/**
 * Positive signal: best session of the week by GMV.
 *
 * @param {Array<object>} thisWeek
 * @returns {{ dateLabel:string, gmv:number }|null}
 */
function bestSession(thisWeek) {
  const withGmv = thisWeek.filter((r) => r.gmv != null);
  if (withGmv.length === 0) return null;
  const best = withGmv.reduce((a, b) => (b.gmv > a.gmv ? b : a));
  const ts = typeof best.startTs === 'number' ? best.startTs : null;
  const dateLabel = ts != null
    ? formatThaiDateWithDow(new Date(ts + BANGKOK_OFFSET_MS))
    : (best.date ?? 'ไม่ทราบวัน');
  return { dateLabel, gmv: best.gmv };
}

/**
 * Positive signal: most improved SKU vs previous week.
 *
 * Compares aggregated GMV per SKU in thisWeek vs lastWeek.
 * Returns null if no SKUs in either window.
 *
 * @param {Array<object>} thisWeek
 * @param {Array<object>} lastWeek
 * @returns {{ name:string, growthPct:number }|null}
 */
function mostImprovedSku(thisWeek, lastWeek) {
  /**
   * Aggregate GMV per normalized SKU name from topSkus arrays.
   *
   * @param {Array<object>} records
   * @returns {Map<string, {displayName:string, gmv:number}>}
   */
  function aggregateSkuGmv(records) {
    /** @type {Map<string, {displayName:string, gmv:number}>} */
    const map = new Map();
    for (const r of records) {
      const skus = Array.isArray(r.topSkus) ? r.topSkus : [];
      for (const sku of skus) {
        if (!sku || !sku.name) continue;
        const key = normalizeSku(sku.name);
        const existing = map.get(key) ?? { displayName: sku.name, gmv: 0 };
        map.set(key, {
          displayName: existing.displayName,
          gmv: existing.gmv + (sku.gmv ?? 0),
        });
      }
    }
    return map;
  }

  const thisMap = aggregateSkuGmv(thisWeek);
  const prevMap = aggregateSkuGmv(lastWeek);

  if (thisMap.size === 0) return null;

  let bestKey = null;
  let bestGrowth = -Infinity;

  for (const [key, { displayName, gmv: thisGmv }] of thisMap) {
    const prevGmv = prevMap.get(key)?.gmv ?? 0;
    // Only consider SKUs with meaningful previous GMV for a true "growth" signal,
    // or newly appeared SKUs with non-zero this-week GMV (prevGmv = 0 → infinity growth).
    if (thisGmv === 0) continue;
    const growthPct = prevGmv > 0
      ? ((thisGmv - prevGmv) / prevGmv) * 100
      : Infinity; // new entry
    if (growthPct > bestGrowth) {
      bestGrowth = growthPct;
      bestKey = key;
    }
  }

  if (bestKey == null) return null;

  const { displayName } = thisMap.get(bestKey);
  return {
    name: displayName,
    growthPct: isFinite(bestGrowth) ? bestGrowth : null, // null = "new this week"
  };
}

// ─── Message builder ──────────────────────────────────────────────────────────

/**
 * Build the CMO Red-flags LINE message (Thai, executive tone).
 *
 * Reads `execReports` from chrome.storage.local and returns the formatted
 * Thai-language string ready for LINE push.
 *
 * @returns {Promise<string>}
 */
export async function buildCmoRedFlags() {
  const { execReports = [] } = await chrome.storage.local.get('execReports');

  const nowMs   = Date.now();
  const ms7d    = 7  * 24 * 60 * 60 * 1000;
  const ms14d   = 14 * 24 * 60 * 60 * 1000;
  const ms35d   = 35 * 24 * 60 * 60 * 1000;

  const thisWeek  = filterWindow(execReports, ms7d, nowMs);
  const lastWeek  = filterWindow(execReports, ms14d, nowMs).filter((r) => !thisWeek.includes(r));
  const last30    = filterWindow(execReports, 30 * 24 * 60 * 60 * 1000, nowMs);
  const prev4Weeks = filterWindow(execReports, ms35d, nowMs).filter((r) => !thisWeek.includes(r));

  // ── Date range label ──────────────────────────────────────────────────────

  const nowBkk  = nowBangkok();
  const weekAgo = new Date(nowBkk.getTime() - ms7d);
  const dateRange = `${formatThaiDate(weekAgo)} – ${formatThaiDate(nowBkk)}`;

  // ── No-data guard ─────────────────────────────────────────────────────────

  if (thisWeek.length === 0) {
    return [
      `📋 CMO Red-flags Report`,
      `🗓 ${dateRange}`,
      ``,
      `ยังไม่มีข้อมูลเพียงพอ — รอสะสมอย่างน้อย 7 วัน`,
    ].join('\n');
  }

  // ── Compute all flags ─────────────────────────────────────────────────────

  const hiImprNoSale   = flagHighImpressionNoSale(thisWeek);
  const missedSlots    = flagMissedGoldenSlots(thisWeek, last30);
  const roas           = flagRoasDecline(thisWeek, prev4Weeks);
  const absentSpikes   = flagPresenterAbsence(thisWeek);
  const quietSpikes    = flagQuietMinutes(thisWeek);
  const best           = bestSession(thisWeek);
  const topGrowthSku   = mostImprovedSku(thisWeek, lastWeek);

  // Check whether any red/yellow flags exist
  const hasRedFlags = hiImprNoSale.length > 0 || missedSlots.length > 0 || roas.declined;
  const hasYellowFlags = absentSpikes.length > 0 || quietSpikes.length > 0;

  // ── Build lines ───────────────────────────────────────────────────────────

  const lines = [
    `📋 CMO Red-flags Report`,
    `🗓 ${dateRange}`,
  ];

  // ── Flag 1: High-impression / no-sale SKUs ────────────────────────────────

  if (hiImprNoSale.length > 0) {
    lines.push(``);
    lines.push(`🔴 SKU อิมเพรสชั่นสูง ขายไม่ออก`);
    for (const sku of hiImprNoSale) {
      const name = sku.name.slice(0, 35);
      lines.push(`  • ${name} — ${sku.impressions.toLocaleString()} impressions, 0 GMV`);
    }
  }

  // ── Flag 2: Missed golden time slots ─────────────────────────────────────

  if (missedSlots.length > 0) {
    lines.push(``);
    lines.push(`🔴 ช่วงเวลาทองหาย`);
    for (const slot of missedSlots) {
      lines.push(`  • ${slot.dateLabel} ขาดไลฟ์ช่วง ${HOUR_BUCKET_LABELS[slot.bucket]}`);
    }
  }

  // ── Flag 3: ROAS decline ──────────────────────────────────────────────────

  if (roas.declined) {
    lines.push(``);
    lines.push(`🔴 ประสิทธิภาพโฆษณาลดลง (ROAS)`);
    const thisStr = roas.thisRoas != null ? roas.thisRoas.toFixed(2) : 'ไม่มีข้อมูล';
    const prevStr = roas.prevRoas != null ? roas.prevRoas.toFixed(2) : 'ไม่มีข้อมูล';
    const dropStr = roas.dropPct  != null ? roas.dropPct.toFixed(1)  : '?';
    lines.push(`  • ROAS สัปดาห์นี้: ${thisStr}x vs เดิม: ${prevStr}x (ลด ${dropStr}%)`);
  } else if (roas.thisRoas == null && roas.prevRoas == null) {
    // All adSpend values are null — skip section silently
  }

  // ── Flag 4: Presenter absence ─────────────────────────────────────────────

  if (absentSpikes.length > 0) {
    lines.push(``);
    lines.push(`🟡 พิธีกรหายบ่อย`);
    for (const s of absentSpikes) {
      lines.push(`  • ${s.dateLabel} — หาย ${s.count} ครั้ง`);
    }
  }

  // ── Flag 5: Quiet-minute spikes ───────────────────────────────────────────

  if (quietSpikes.length > 0) {
    lines.push(``);
    lines.push(`🟡 นาทีเงียบมากเกินไป`);
    for (const s of quietSpikes) {
      lines.push(`  • ${s.dateLabel} — เงียบ ${s.quietMinutes} นาที`);
    }
  }

  // ── No flags at all ───────────────────────────────────────────────────────

  if (!hasRedFlags && !hasYellowFlags) {
    lines.push(``);
    lines.push(`✅ ไม่พบจุดเสี่ยงในสัปดาห์นี้ — ยอดเยี่ยมมาก!`);
  }

  // ── Positive signals ──────────────────────────────────────────────────────

  lines.push(``);
  lines.push(`🟢 จุดเด่นสัปดาห์นี้`);

  if (best != null) {
    lines.push(`  • ไลฟ์ยอดดีที่สุด: ${best.dateLabel} ${formatGmv(best.gmv)}`);
  } else {
    lines.push(`  • ไลฟ์ยอดดีที่สุด: ไม่มีข้อมูล GMV`);
  }

  if (topGrowthSku != null) {
    const name = topGrowthSku.name.slice(0, 35);
    const growthStr = topGrowthSku.growthPct != null
      ? `+${topGrowthSku.growthPct.toFixed(0)}%`
      : 'ใหม่สัปดาห์นี้';
    lines.push(`  • SKU โตเร็วสุด: ${name} ${growthStr}`);
  } else {
    lines.push(`  • SKU โตเร็วสุด: ไม่มีข้อมูลเปรียบเทียบ`);
  }

  return lines.join('\n');
}

/**
 * Build the CMO Red-flags message and send it via LINE.
 *
 * @returns {Promise<void>}
 */
export async function sendCmoRedFlagsToLine() {
  try {
    const text   = await buildCmoRedFlags();
    const result = await sendLineMessage(text);
    if (!result.ok) {
      console.warn('[LiveWatch] sendCmoRedFlagsToLine: LINE send failed:', result.error);
    }
  } catch (e) {
    console.error('[LiveWatch] sendCmoRedFlagsToLine error:', e);
  }
}
