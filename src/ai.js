'use strict';

/**
 * ai.js — Thin client for the LiveWatch SaaS AI analysis proxy.
 *
 * All AI inference happens server-side at /api/ai/analyze using a
 * server-owned Pollinations API key. Users do NOT provide their own key.
 *
 * Tier-based rate limits are enforced by the backend. On 429 the badge
 * is set to indicate throttling.
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {number} smile_score
 * @property {number} eye_contact_score
 * @property {number} energy_level
 * @property {number} engagement_score
 * @property {number} lighting_quality
 * @property {boolean} phone_detected
 * @property {boolean} product_presenting
 * @property {boolean} presenter_visible
 * @property {string} activity_summary
 * @property {boolean} alert_flag
 */

/**
 * Analyze 1-5 base64-encoded JPEG frames via the SaaS backend.
 * Returns null on any failure (no auth, rate limited, network error).
 *
 * @param {string[]} base64Frames
 * @returns {Promise<AnalysisResult|null>}
 */
export async function analyzeFrames(base64Frames) {
  if (!Array.isArray(base64Frames) || base64Frames.length === 0) {
    return null;
  }

  const { config } = await chrome.storage.local.get('config');
  const apiBase = (config?.apiBase ?? 'https://livewatch-psi.vercel.app').replace(/\/$/, '');
  const apiToken = config?.apiToken;
  if (!apiToken) {
    console.warn('[LiveWatch] ai.analyzeFrames: no apiToken — skipping');
    return null;
  }

  try {
    const res = await fetch(`${apiBase}/api/ai/analyze`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        frames: base64Frames.map((b64) => ({ base64: b64 })),
      }),
    });

    if (res.status === 429) {
      console.warn('[LiveWatch] ai.analyzeFrames: tier rate limit');
      try {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#FFA500' });
      } catch (_) { /* noop */ }
      return null;
    }
    if (res.status === 401) {
      console.warn('[LiveWatch] ai.analyzeFrames: token invalid');
      return null;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => String(res.status));
      console.warn('[LiveWatch] ai.analyzeFrames failed:', res.status, detail.slice(0, 200));
      return null;
    }

    return /** @type {AnalysisResult} */ (await res.json());
  } catch (e) {
    console.warn('[LiveWatch] ai.analyzeFrames network error:', e);
    return null;
  }
}
