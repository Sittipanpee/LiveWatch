/**
 * analytics.js — Post-session analytics scraper for LiveWatch.
 *
 * ES module imported by background.js (service worker, type: module).
 * After a live session ends, opens the TikTok analytics page and scrapes
 * historical data from the #live-details-anchor table.
 *
 * Best-effort: if the DOM has changed or the page requires login, the
 * scrape fails gracefully and returns null.
 */

'use strict';

const ANALYTICS_URL = 'https://shop.tiktok.com/streamer/compass/livestream-analytics/view';
const SCRAPE_DELAY_MS = 3000;

/**
 * Open the analytics page in a new tab, wait for it to load, then send
 * a SCRAPE_ANALYTICS message to the content script to extract table data.
 *
 * @param {number} tabId - Tab ID where the content script is running
 * @returns {Promise<{ rows: Array<object> } | null>}
 */
export async function scrapeAnalytics(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_ANALYTICS' });

    if (!response || response.error) {
      console.warn('[LiveWatch] scrapeAnalytics: content script returned error:', response?.error);
      return null;
    }

    return response;
  } catch (e) {
    console.warn('[LiveWatch] scrapeAnalytics: sendMessage failed:', e?.message);
    return null;
  }
}

/**
 * Schedule an analytics scrape after a session ends.
 * Opens a new tab to the analytics page, waits for load + delay,
 * scrapes data, stores result, then closes the tab.
 *
 * @param {string} sessionId - Session ID for tagging the result
 * @returns {Promise<void>}
 */
export async function scheduleAnalyticsScrape(sessionId) {
  let analyticsTab = null;

  try {
    console.info('[LiveWatch] scheduleAnalyticsScrape: opening analytics page for session', sessionId);

    // Open analytics page in a new background tab
    analyticsTab = await chrome.tabs.create({
      url: ANALYTICS_URL,
      active: false,
    });

    if (!analyticsTab?.id) {
      console.warn('[LiveWatch] scheduleAnalyticsScrape: failed to create tab');
      return;
    }

    // Wait for the tab to finish loading
    await new Promise((resolve) => {
      const onUpdated = (tabId, info) => {
        if (tabId === analyticsTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      // Safety timeout: don't wait forever
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 15000);
    });

    // Extra delay for JS rendering
    await new Promise((r) => setTimeout(r, SCRAPE_DELAY_MS));

    // Inject content script if not already present
    try {
      await chrome.scripting.executeScript({
        target: { tabId: analyticsTab.id },
        files: ['src/content.js'],
      });
    } catch (_) {
      // May already be injected via manifest match
    }

    // Small delay after injection
    await new Promise((r) => setTimeout(r, 500));

    // Scrape the analytics data
    const result = await scrapeAnalytics(analyticsTab.id);

    if (result && result.rows && result.rows.length > 0) {
      // Store in chrome.storage.local
      const { analyticsHistory = [] } = await chrome.storage.local.get('analyticsHistory');
      const entry = {
        session_id: sessionId,
        scraped_at: new Date().toISOString(),
        rows: result.rows,
      };
      const updated = [...analyticsHistory, entry].slice(-50); // keep last 50 scrapes
      await chrome.storage.local.set({ analyticsHistory: updated });

      console.info('[LiveWatch] scheduleAnalyticsScrape: stored', result.rows.length, 'rows for session', sessionId);
    } else {
      console.warn('[LiveWatch] scheduleAnalyticsScrape: no data scraped for session', sessionId);
    }
  } catch (e) {
    console.error('[LiveWatch] scheduleAnalyticsScrape error:', e);
  } finally {
    // Close the analytics tab
    if (analyticsTab?.id) {
      try {
        await chrome.tabs.remove(analyticsTab.id);
      } catch (_) {
        // Tab may already be closed
      }
    }
  }
}
