/**
 * tier.js — Subscription tier enforcement for LiveWatch.
 *
 * Fetches the user's plan from the SaaS backend and exposes helpers for
 * caching, fail-safe defaults, and clamping the capture interval to the
 * tier's minimum gap. Imported by background.js (ES module).
 *
 * Fail-safe rule: on ANY error, callers fall back to the 'gold' tier
 * (the most restrictive plan) so the extension never accidentally captures
 * faster than the slowest paid plan allows.
 */

'use strict';

/** @typedef {'gold'|'platinum'|'diamond'} UserTier */
/** @typedef {{ maxPerHour: number, minIntervalMinutes: number }} TierLimits */
/** @typedef {{ tier: UserTier, maxPerHour: number, minIntervalMinutes: number, fetchedAt: number }} CachedTier */

/**
 * Tier limits — must stay in sync with the SaaS backend.
 */
export const TIER_LIMITS = Object.freeze({
  gold:     { maxPerHour: 3,  minIntervalMinutes: 20 },
  platinum: { maxPerHour: 6,  minIntervalMinutes: 10 },
  diamond:  { maxPerHour: 12, minIntervalMinutes: 5  },
});

const CACHE_KEY = 'userTier';
const DEFAULT_TIER = 'gold';

/**
 * Build a CachedTier object for a given tier name.
 *
 * @param {UserTier} tier
 * @param {number} fetchedAt
 * @returns {CachedTier}
 */
function buildCached(tier, fetchedAt) {
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS[DEFAULT_TIER];
  return {
    tier,
    maxPerHour: limits.maxPerHour,
    minIntervalMinutes: limits.minIntervalMinutes,
    fetchedAt,
  };
}

/**
 * Fetch the user's tier from the SaaS backend.
 * Returns null on any non-2xx response or network error.
 *
 * @param {string} apiBase
 * @param {string} authToken
 * @returns {Promise<CachedTier|null>}
 */
export async function fetchUserTier(apiBase, authToken) {
  if (!apiBase || !authToken) return null;
  try {
    const res = await fetch(`${apiBase}/api/user/tier`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      console.warn('[LiveWatch] fetchUserTier non-2xx:', res.status);
      return null;
    }
    const data = await res.json();
    const tier = (data && TIER_LIMITS[data.tier]) ? data.tier : DEFAULT_TIER;
    return buildCached(tier, Date.now());
  } catch (e) {
    console.warn('[LiveWatch] fetchUserTier error:', e?.message);
    return null;
  }
}

/**
 * Read cached tier from chrome.storage.local; returns gold fallback if missing
 * or malformed. Never throws.
 *
 * @returns {Promise<CachedTier>}
 */
export async function getCachedTier() {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cached = result?.[CACHE_KEY];
    if (
      cached &&
      typeof cached === 'object' &&
      typeof cached.tier === 'string' &&
      TIER_LIMITS[cached.tier] &&
      typeof cached.minIntervalMinutes === 'number' &&
      typeof cached.maxPerHour === 'number'
    ) {
      return cached;
    }
  } catch (e) {
    console.warn('[LiveWatch] getCachedTier error:', e?.message);
  }
  return buildCached(DEFAULT_TIER, 0);
}

/**
 * Fetch the user tier and persist it to chrome.storage.local.
 * On failure, leaves the existing cache intact (or returns the gold fallback
 * from getCachedTier if no cache exists).
 *
 * @param {string} apiBase
 * @param {string} authToken
 * @returns {Promise<CachedTier>}
 */
export async function refreshTierCache(apiBase, authToken) {
  const fresh = await fetchUserTier(apiBase, authToken);
  if (fresh) {
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: fresh });
    } catch (e) {
      console.warn('[LiveWatch] refreshTierCache persist error:', e?.message);
    }
    return fresh;
  }
  // Graceful fallback: keep existing cache, or return gold default.
  return getCachedTier();
}

/**
 * Enforce the tier minimum as a floor on the user's configured interval.
 *
 * @param {number} userSettingMinutes
 * @param {{ minIntervalMinutes: number }} tierLimits
 * @returns {number}
 */
export function effectiveCaptureInterval(userSettingMinutes, tierLimits) {
  const userVal = Number.isFinite(userSettingMinutes) ? userSettingMinutes : 0;
  const floor = tierLimits?.minIntervalMinutes ?? TIER_LIMITS[DEFAULT_TIER].minIntervalMinutes;
  return Math.max(userVal, floor);
}
