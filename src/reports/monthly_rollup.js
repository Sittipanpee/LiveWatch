/**
 * monthly_rollup.js — Wave 2 Executive Reporting
 *
 * Builds a Thai-language monthly summary LINE message from the last 30 days of
 * execReports (compact per-session records stored in chrome.storage.local).
 *
 * ES module — imported by background.js (MV3 service worker, type: module).
 * No runtime side-effects on import; all logic lives in exported functions.
 */

import { sendLineMessage } from '../line.js';

// ─── Bangkok timezone offset (UTC+7) ─────────────────────────────────────────

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Return a Date adjusted to Asia/Bangkok wall-clock time (UTC representation).
 *
 * @returns {Date}
 */
function nowBangkok() {
  return new Date(Date.now() + BANGKOK_OFFSET_MS);
}

// ─── Thai day-of-week labels (Mon=1 … Sun=0) ─────────────────────────────────

const THAI_DOW = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

// ─── Formatting helpers ───────────────────────────────────────────────────────

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
 * Format satang as Thai baht string "฿1,234.56".
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

// ─── Data filtering helpers ───────────────────────────────────────────────────

/**
 * Filter execReports to the window [nowMs - windowMs, nowMs].
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
 * Sum a numeric field across records.
 *
 * @param {Array<object>} records
 * @param {string} field
 * @returns {number}
 */
function sumField(records, field) {
  return records.reduce((acc, r) => acc + (r[field] ?? 0), 0);
}

/**
 * Aggregate topSkus across records.
 * Returns the top N by total GMV.
 *
 * @param {Array<object>} records
 * @param {number} [topN=10]
 * @returns {Array<{name:string, gmv:number, units:number}>}
 */
function aggregateTopSkus(records, topN = 10) {
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
 * Compute average GMV per day-of-week (0=Sun … 6=Sat).
 * Uses record.startTs to determine the Bangkok day-of-week.
 *
 * @param {Array<object>} records
 * @returns {Array<{dow: number, label: string, avgGmv: number, count: number}>}
 */
function avgGmvByDow(records) {
  const buckets = Array.from({ length: 7 }, (_, i) => ({ dow: i, sum: 0, count: 0 }));

  for (const r of records) {
    if (r.gmv == null || typeof r.startTs !== 'number') continue;
    // Shift epoch to Bangkok wall-clock, then get JS day-of-week
    const bangkokDate = new Date(r.startTs + BANGKOK_OFFSET_MS);
    const dow = bangkokDate.getUTCDay(); // 0=Sun … 6=Sat
    buckets[dow].sum   += r.gmv;
    buckets[dow].count += 1;
  }

  return buckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      dow:    b.dow,
      label:  THAI_DOW[b.dow],
      avgGmv: Math.round(b.sum / b.count),
      count:  b.count,
    }))
    .sort((a, b) => b.avgGmv - a.avgGmv);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a Thai-language monthly summary LINE message.
 *
 * Reads `execReports` from chrome.storage.local, filters to the last 30 days,
 * and produces a structured message.  Returns a "no data yet" message gracefully
 * when the array is empty or missing.
 *
 * @returns {Promise<string>} formatted LINE message text
 */
export async function buildMonthlyRollup() {
  const { execReports = [] } = await chrome.storage.local.get('execReports');

  const nowMs  = Date.now();
  const ms30d  = 30 * 24 * 60 * 60 * 1000;

  const thisMonth = filterWindow(execReports, ms30d, nowMs);

  // ── Date range label ──────────────────────────────────────────────────────

  const nowBkk    = nowBangkok();
  const monthAgo  = new Date(nowBkk.getTime() - ms30d);
  const dateRange = `${formatThaiDate(monthAgo)} – ${formatThaiDate(nowBkk)}`;

  // ── No-data guard ─────────────────────────────────────────────────────────

  if (thisMonth.length === 0) {
    return [
      `📅 สรุปเดือนที่ผ่านมา (${dateRange})`,
      ``,
      `ยังไม่มีข้อมูลไลฟ์ในช่วง 30 วันที่ผ่านมา`,
      `เริ่มไลฟ์และเปิด LiveWatch เพื่อเก็บสถิติ`,
    ].join('\n');
  }

  // ── Aggregates ────────────────────────────────────────────────────────────

  const totalGmv      = sumField(thisMonth, 'gmv');
  const totalUnits    = sumField(thisMonth, 'units');
  const sessionCount  = thisMonth.length;
  const totalMins     = sumField(thisMonth, 'durationMin');
  const avgGmvPerSess = sessionCount > 0 ? Math.round(totalGmv / sessionCount) : null;
  const avgDuration   = sessionCount > 0 ? Math.round(totalMins / sessionCount) : 0;

  // Top 10 SKUs
  const top10skus = aggregateTopSkus(thisMonth, 10);

  // Per-weekday avg GMV
  const dowStats = avgGmvByDow(thisMonth);

  // ── Build message lines ───────────────────────────────────────────────────

  const lines = [
    `📅 สรุปเดือนที่ผ่านมา (${dateRange})`,
    ``,
    `📊 ภาพรวมเดือนนี้:`,
    `  💰 GMV รวม: ${formatGmv(totalGmv)}`,
    `  📦 ยอดขายรวม: ${totalUnits.toLocaleString()} ชิ้น`,
    `  🎬 จำนวนไลฟ์: ${sessionCount} ครั้ง`,
    `  ⏱ ไลฟ์รวม: ${formatDuration(totalMins)}`,
    `  💰 GMV เฉลี่ย/ไลฟ์: ${formatGmv(avgGmvPerSess)}`,
    `  ⏱ ความยาวเฉลี่ย: ${formatDuration(avgDuration)}`,
  ];

  // Top 10 SKUs
  if (top10skus.length > 0) {
    lines.push(``);
    lines.push(`📦 Top 10 สินค้า (GMV รวมเดือน):`);
    top10skus.forEach((sku, i) => {
      const name    = sku.name.slice(0, 30);
      const gmvStr  = formatGmv(sku.gmv);
      const unitStr = sku.units > 0 ? ` · ${sku.units} ชิ้น` : '';
      lines.push(`  ${i + 1}. ${name} — ${gmvStr}${unitStr}`);
    });
  }

  // Per-weekday avg GMV
  if (dowStats.length > 0) {
    lines.push(``);
    lines.push(`📅 GMV เฉลี่ยตามวัน:`);
    dowStats.forEach((d) => {
      lines.push(`  วัน${d.label}: ${formatGmv(d.avgGmv)} (${d.count} ไลฟ์)`);
    });
  }

  return lines.join('\n');
}

/**
 * Build the monthly rollup message and send it via LINE.
 *
 * @returns {Promise<void>}
 */
export async function sendMonthlyRollupToLine() {
  try {
    const text = await buildMonthlyRollup();
    const result = await sendLineMessage(text);
    if (!result.ok) {
      console.warn('[LiveWatch] sendMonthlyRollupToLine: LINE send failed:', result.error);
    }
  } catch (e) {
    console.error('[LiveWatch] sendMonthlyRollupToLine error:', e);
  }
}
