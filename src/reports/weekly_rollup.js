/**
 * weekly_rollup.js — Wave 2 Executive Reporting
 *
 * Builds a Thai-language weekly summary LINE message from the last 7 days of
 * execReports (compact per-session records stored in chrome.storage.local).
 *
 * ES module — imported by background.js (MV3 service worker, type: module).
 * No runtime side-effects on import; all logic lives in exported functions.
 */

import { sendLineMessage } from '../line.js';

// ─── Bangkok timezone offset (UTC+7) ─────────────────────────────────────────

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Return a Date object representing "now" in Asia/Bangkok wall-clock time
 * but expressed as a plain Date (i.e. the Date value equals Bangkok midnight
 * when getHours() is called on it without TZ correction — sufficient for
 * within-extension comparisons where we never serialise to a TZ-aware string).
 *
 * @returns {Date}
 */
function nowBangkok() {
  return new Date(Date.now() + BANGKOK_OFFSET_MS);
}

/**
 * Strip the time component from a Bangkok-adjusted Date and return epoch ms.
 *
 * @param {Date} bangkokDate
 * @returns {number} midnight epoch (Bangkok) in ms
 */
function bangkokMidnight(bangkokDate) {
  const d = new Date(bangkokDate);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

// ─── Thai formatting helpers ──────────────────────────────────────────────────

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const HOUR_BUCKET_LABELS = [
  '00:00–06:00',
  '06:00–12:00',
  '12:00–18:00',
  '18:00–24:00',
];

/**
 * Format a Date (Bangkok-adjusted) as Thai short-date string "6 เม.ย."
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
 * Format total minutes as "X ชั่วโมง Y นาที".
 *
 * @param {number} totalMins
 * @returns {string}
 */
function formatDuration(totalMins) {
  const hours = Math.floor(totalMins / 60);
  const mins  = totalMins % 60;
  if (hours === 0) return `${mins} นาที`;
  if (mins  === 0) return `${hours} ชั่วโมง`;
  return `${hours} ชั่วโมง ${mins} นาที`;
}

/**
 * Format a signed satang delta as "+฿X" or "-฿X".
 *
 * @param {number} delta
 * @returns {string}
 */
function formatDelta(delta) {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${formatGmv(delta)}`;
}

/**
 * Format a signed percentage change.
 *
 * @param {number|null} pct — may be null
 * @returns {string}
 */
function formatPct(pct) {
  if (pct == null) return 'ไม่มีข้อมูล';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Determine the hourBucket (0–3) from a Bangkok-adjusted Date.
 *   0 → 00:00–06:00
 *   1 → 06:00–12:00
 *   2 → 12:00–18:00
 *   3 → 18:00–24:00
 *
 * @param {Date} bangkokDate
 * @returns {number}
 */
function hourBucketOf(bangkokDate) {
  const h = bangkokDate.getUTCHours();
  return Math.min(3, Math.floor(h / 6));
}

// ─── Data filtering helpers ───────────────────────────────────────────────────

/**
 * Filter execReports to the window [nowMs - windowMs, nowMs].
 * Uses record.startTs (epoch ms) for comparison.
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

// ─── Aggregate helpers ────────────────────────────────────────────────────────

/**
 * Sum a numeric field across an array of records, skipping null/undefined.
 *
 * @param {Array<object>} records
 * @param {string} field
 * @returns {number}
 */
function sumField(records, field) {
  return records.reduce((acc, r) => acc + (r[field] ?? 0), 0);
}

/**
 * Compute the mean of a numeric field, null if no valid values.
 *
 * @param {Array<object>} records
 * @param {string} field
 * @returns {number|null}
 */
function meanField(records, field) {
  const valid = records.filter((r) => r[field] != null);
  if (valid.length === 0) return null;
  return valid.reduce((acc, r) => acc + r[field], 0) / valid.length;
}

/**
 * Aggregate topSkus across records.
 * Each record.topSkus is [{name, gmv, units}, ...].
 * Returns the top N by total GMV.
 *
 * @param {Array<object>} records
 * @param {number} [topN=5]
 * @returns {Array<{name:string, gmv:number, units:number}>}
 */
function aggregateTopSkus(records, topN = 5) {
  /** @type {Map<string, {gmv: number, units: number}>} */
  const byName = new Map();

  for (const r of records) {
    const skus = Array.isArray(r.topSkus) ? r.topSkus : [];
    for (const sku of skus) {
      if (!sku || !sku.name) continue;
      const existing = byName.get(sku.name) ?? { gmv: 0, units: 0 };
      byName.set(sku.name, {
        gmv:   existing.gmv   + (sku.gmv   ?? 0),
        units: existing.units + (sku.units  ?? 0),
      });
    }
  }

  return [...byName.entries()]
    .map(([name, vals]) => ({ name, ...vals }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, topN);
}

/**
 * Aggregate trafficMix across records.
 * Each record.trafficMix is [{channel, pct}, ...].
 * Returns channels sorted by avg pct across sessions that had that channel.
 *
 * @param {Array<object>} records
 * @param {number} [topN=3]
 * @returns {Array<{channel:string, avgPct:number}>}
 */
function aggregateTrafficMix(records, topN = 3) {
  /** @type {Map<string, {sum: number, count: number}>} */
  const byChannel = new Map();

  for (const r of records) {
    const mix = Array.isArray(r.trafficMix) ? r.trafficMix : [];
    for (const entry of mix) {
      if (!entry || !entry.channel) continue;
      const existing = byChannel.get(entry.channel) ?? { sum: 0, count: 0 };
      byChannel.set(entry.channel, {
        sum:   existing.sum   + (entry.pct ?? 0),
        count: existing.count + 1,
      });
    }
  }

  return [...byChannel.entries()]
    .map(([channel, { sum, count }]) => ({ channel, avgPct: count > 0 ? sum / count : 0 }))
    .sort((a, b) => b.avgPct - a.avgPct)
    .slice(0, topN);
}

/**
 * Find the best hour bucket (0–3) by average GMV across sessions.
 *
 * @param {Array<object>} records
 * @returns {{ bucket: number, avgGmv: number|null }}
 */
function bestHourBucket(records) {
  const buckets = [
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
  ];

  for (const r of records) {
    const b = typeof r.hourBucket === 'number' ? r.hourBucket : null;
    if (b == null || b < 0 || b > 3) continue;
    if (r.gmv == null) continue;
    buckets[b].sum   += r.gmv;
    buckets[b].count += 1;
  }

  let bestIdx = -1;
  let bestAvg = -Infinity;
  for (let i = 0; i < 4; i++) {
    if (buckets[i].count === 0) continue;
    const avg = buckets[i].sum / buckets[i].count;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestIdx = i;
    }
  }

  return {
    bucket: bestIdx >= 0 ? bestIdx : null,
    avgGmv: bestIdx >= 0 ? Math.round(bestAvg) : null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a Thai-language weekly summary LINE message.
 *
 * Reads `execReports` from chrome.storage.local, filters to the last 7 days,
 * and produces a structured message.  Returns a "no data yet" message gracefully
 * when the array is empty or missing.
 *
 * @returns {Promise<string>} formatted LINE message text
 */
export async function buildWeeklyRollup() {
  const { execReports = [] } = await chrome.storage.local.get('execReports');

  const nowMs    = Date.now();
  const ms7d     = 7  * 24 * 60 * 60 * 1000;
  const ms14d    = 14 * 24 * 60 * 60 * 1000;

  const thisWeek = filterWindow(execReports, ms7d,  nowMs);
  const lastWeek = filterWindow(execReports, ms14d, nowMs).filter(
    (r) => !thisWeek.includes(r)
  );

  // ── Date range label ──────────────────────────────────────────────────────

  const nowBkk   = nowBangkok();
  const weekAgo  = new Date(nowBkk.getTime() - ms7d);
  const dateRange = `${formatThaiDate(weekAgo)} – ${formatThaiDate(nowBkk)}`;

  // ── No-data guard ─────────────────────────────────────────────────────────

  if (thisWeek.length === 0) {
    return [
      `🗓 สรุปสัปดาห์ที่ผ่านมา (${dateRange})`,
      ``,
      `ยังไม่มีข้อมูลไลฟ์ในช่วง 7 วันที่ผ่านมา`,
      `เริ่มไลฟ์และเปิด LiveWatch เพื่อเก็บสถิติ`,
    ].join('\n');
  }

  // ── This-week aggregates ──────────────────────────────────────────────────

  const totalGmv     = sumField(thisWeek, 'gmv');
  const totalUnits   = sumField(thisWeek, 'units');
  const sessionCount = thisWeek.length;
  const totalMins    = sumField(thisWeek, 'durationMin');
  const avgGmvPerSession = sessionCount > 0 ? Math.round(totalGmv / sessionCount) : null;

  // ── Top 3 sessions by GMV ─────────────────────────────────────────────────

  const top3sessions = [...thisWeek]
    .filter((r) => r.gmv != null)
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 3);

  // ── Top 5 SKUs ────────────────────────────────────────────────────────────

  const top5skus = aggregateTopSkus(thisWeek, 5);

  // ── Top 3 traffic channels ────────────────────────────────────────────────

  const top3traffic = aggregateTrafficMix(thisWeek, 3);

  // ── Trend vs previous 7 days ──────────────────────────────────────────────

  const prevGmv          = lastWeek.length > 0 ? sumField(lastWeek, 'gmv') : null;
  const prevSessions     = lastWeek.length;
  const prevAvgGmv       = prevSessions > 0 ? Math.round(sumField(lastWeek, 'gmv') / prevSessions) : null;

  const gmvChangePct     = (prevGmv != null && prevGmv > 0)
    ? ((totalGmv - prevGmv) / prevGmv) * 100
    : null;
  const sessionsChangePct = (prevSessions > 0)
    ? ((sessionCount - prevSessions) / prevSessions) * 100
    : null;
  const avgGmvChangePct  = (prevAvgGmv != null && prevAvgGmv > 0 && avgGmvPerSession != null)
    ? ((avgGmvPerSession - prevAvgGmv) / prevAvgGmv) * 100
    : null;

  // ── Best time-of-day bucket ───────────────────────────────────────────────

  const { bucket: bestBucket, avgGmv: bestBucketAvgGmv } = bestHourBucket(thisWeek);

  // ── Build message lines ───────────────────────────────────────────────────

  const lines = [
    `🗓 สรุปสัปดาห์ที่ผ่านมา (${dateRange})`,
    ``,
    `📊 รวมสัปดาห์นี้:`,
    `  💰 GMV รวม: ${formatGmv(totalGmv)}`,
    `  📦 ยอดขายรวม: ${totalUnits.toLocaleString()} ชิ้น`,
    `  🎬 จำนวนไลฟ์: ${sessionCount} ครั้ง`,
    `  ⏱ ไลฟ์รวม: ${formatDuration(totalMins)}`,
  ];

  // Top 3 sessions
  if (top3sessions.length > 0) {
    lines.push(``);
    lines.push(`🏆 Top 3 ไลฟ์ (GMV สูงสุด):`);
    top3sessions.forEach((r, i) => {
      const dateLabel = r.date ?? 'ไม่ทราบวัน';
      const gmvLabel  = formatGmv(r.gmv);
      const durLabel  = formatDuration(r.durationMin ?? 0);
      lines.push(`  ${i + 1}. ${dateLabel} — ${gmvLabel} (${durLabel})`);
    });
  }

  // Top 5 SKUs
  if (top5skus.length > 0) {
    lines.push(``);
    lines.push(`📦 Top 5 สินค้า (GMV รวม):`);
    top5skus.forEach((sku, i) => {
      const name    = sku.name.slice(0, 30);
      const gmvStr  = formatGmv(sku.gmv);
      const unitStr = sku.units > 0 ? ` · ${sku.units} ชิ้น` : '';
      lines.push(`  ${i + 1}. ${name} — ${gmvStr}${unitStr}`);
    });
  }

  // Top 3 traffic channels
  if (top3traffic.length > 0) {
    lines.push(``);
    lines.push(`🚦 แหล่งที่มา (เฉลี่ยต่อไลฟ์):`);
    top3traffic.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.channel} — ${t.avgPct.toFixed(1)}%`);
    });
  }

  // Trend vs previous 7 days
  lines.push(``);
  lines.push(`📈 เทียบสัปดาห์ก่อน:`);
  lines.push(`  GMV: ${formatPct(gmvChangePct)}`);
  lines.push(`  จำนวนไลฟ์: ${formatPct(sessionsChangePct)}`);
  lines.push(`  GMV เฉลี่ย/ไลฟ์: ${formatPct(avgGmvChangePct)}`);

  // Best time-of-day slot
  if (bestBucket != null) {
    lines.push(``);
    lines.push(`⏰ ช่วงเวลาดีที่สุด: ${HOUR_BUCKET_LABELS[bestBucket]} (เฉลี่ย GMV ${formatGmv(bestBucketAvgGmv)})`);
  }

  return lines.join('\n');
}

/**
 * Build the weekly rollup message and send it via LINE.
 *
 * @returns {Promise<void>}
 */
export async function sendWeeklyRollupToLine() {
  try {
    const text = await buildWeeklyRollup();
    const result = await sendLineMessage(text);
    if (!result.ok) {
      console.warn('[LiveWatch] sendWeeklyRollupToLine: LINE send failed:', result.error);
    }
  } catch (e) {
    console.error('[LiveWatch] sendWeeklyRollupToLine error:', e);
  }
}
