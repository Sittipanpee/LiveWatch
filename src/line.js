/**
 * line.js
 * LINE Messaging API integration — sends push messages to the shop owner.
 *
 * Credentials are read from chrome.storage.local (keys: lineToken, lineUserId).
 */

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read LINE credentials from chrome.storage.local.
 *
 * @returns {Promise<{ lineToken: string, lineUserId: string }>}
 * @throws {Error} if credentials are missing
 */
async function getLineCredentials() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['lineToken', 'lineUserId'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const { lineToken, lineUserId } = result;
      if (!lineToken || !lineUserId) {
        reject(new Error('LINE credentials not configured. Set lineToken and lineUserId in storage.'));
        return;
      }
      resolve({ lineToken, lineUserId });
    });
  });
}

/**
 * Format total minutes into Thai-style "X ชั่วโมง Y นาที" string.
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
 * Format a Date (or today) into Thai short-month format: "6 เม.ย."
 *
 * @param {Date} [date]
 * @returns {string}
 */
function formatThaiDate(date = new Date()) {
  const THAI_MONTHS = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  const day = date.getDate();
  const month = THAI_MONTHS[date.getMonth()];
  return `${day} ${month}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a plain-text LINE push message.
 *
 * Tries the SaaS proxy first (if apiToken is configured), then falls back to
 * direct LINE API credentials.  After SaaS migration the direct credentials
 * are no longer stored, so the proxy path is the primary route.
 *
 * @param {string} text - Message text (supports LINE newlines via \n)
 * @returns {Promise<{ ok: boolean, error: string | null }>}
 */
export async function sendLineMessage(text) {
  // ── 1. Try SaaS proxy (primary path post-migration) ──────────────────────
  try {
    const { config } = await chrome.storage.local.get('config');
    const apiToken = config?.apiToken;

    if (apiToken) {
      const proxyUrl = 'https://livewatch-psi.vercel.app/api/line/send';
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        return { ok: true, error: null };
      }

      // Non-OK from proxy — log but fall through to direct path
      let detail = '';
      try {
        const json = await res.json();
        detail = json.message || json.error || '';
      } catch { /* ignore */ }
      console.warn(
        `[line.js] SaaS proxy error ${res.status}${detail ? ': ' + detail : ''} — trying direct LINE API`
      );
    }
  } catch (proxyErr) {
    console.warn('[line.js] SaaS proxy network error:', proxyErr?.message, '— trying direct LINE API');
  }

  // ── 2. Fallback: direct LINE API (legacy / self-hosted) ──────────────────
  let lineToken, lineUserId;
  try {
    ({ lineToken, lineUserId } = await getLineCredentials());
  } catch (err) {
    console.error('[line.js] Credential error:', err.message);
    return { ok: false, error: err.message };
  }

  const body = {
    to: lineUserId,
    messages: [
      {
        type: 'text',
        text,
      },
    ],
  };

  let response;
  try {
    response = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lineToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    console.error('[line.js] Network error:', networkErr.message);
    return { ok: false, error: networkErr.message };
  }

  if (!response.ok) {
    let detail = '';
    try {
      const json = await response.json();
      detail = json.message || json.error || '';
    } catch {
      // ignore parse error
    }
    const msg = `LINE API error ${response.status}${detail ? ': ' + detail : ''}`;
    console.error('[line.js]', msg);
    return { ok: false, error: msg };
  }

  return { ok: true, error: null };
}

/**
 * Build the Thai-language daily summary text for a LINE push message.
 *
 * @param {object} summary - Daily summary data
 * @param {number} summary.total_live_mins      - Total live minutes today
 * @param {number} summary.avg_smile_score      - Average smile score (0-100)
 * @param {number} summary.avg_eye_contact_score - Average eye contact score (0-100)
 * @param {number} summary.product_presenting_pct - % of time product was presented
 * @param {number} summary.phone_incidents       - Number of phone-detected incidents
 * @param {Date}   [summary.date]                - Date of summary (defaults to today)
 * @returns {string} Formatted LINE message text
 */
export function buildDailySummaryText(summary) {
  const {
    total_live_mins = 0,
    avg_smile_score = 0,
    avg_eye_contact_score = 0,
    product_presenting_pct = 0,
    phone_incidents = 0,
    date,
  } = summary;

  const dateLabel = formatThaiDate(date ? new Date(date) : undefined);
  const duration = formatDuration(total_live_mins);
  const smile = Math.round(avg_smile_score);
  const eye = Math.round(avg_eye_contact_score);
  const productPct = Number(product_presenting_pct).toFixed(1);

  return [
    `📊 สรุปไลฟ์วันนี้ (${dateLabel})`,
    `⏱ ไลฟ์ทั้งหมด: ${duration}`,
    `😊 ยิ้มแย้มเฉลี่ย: ${smile}/100`,
    `👁 มองกล้องเฉลี่ย: ${eye}/100`,
    `📦 เสนอสินค้า: ${productPct}% ของเวลา`,
    `📱 จับมือถือ: ${phone_incidents} ครั้ง`,
  ].join('\n');
}
