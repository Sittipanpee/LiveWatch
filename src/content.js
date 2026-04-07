/**
 * content.js — TikTok Shop Helper (LiveWatch)
 * Injected into: shop.tiktok.com/streamer/live/*
 *
 * Responsibilities:
 *  - Detect TikTok Live video element (XGPlayer) appearing / disappearing in DOM
 *  - Notify background.js: LIVE_STARTED / LIVE_ENDED
 *  - Respond to CAPTURE_BURST command with 3 JPEG frames, 5 s apart
 *  - Send HEARTBEAT to background.js every 30 s
 *  - Extract page metadata (viewer count, title, URL)
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants (inlined — content scripts cannot import ES modules without bundler)
// ---------------------------------------------------------------------------

const MSG = {
  LIVE_STARTED:  'LIVE_STARTED',
  LIVE_ENDED:    'LIVE_ENDED',
  HEARTBEAT:     'HEARTBEAT',
  CAPTURE_BURST: 'CAPTURE_BURST',
  BURST_RESULT:  'BURST_RESULT',
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const FRAME_GAP_MS          = 5_000;
const FRAMES_PER_BURST      = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {HTMLVideoElement|null} */
let liveVideo      = null;

/** @type {boolean} Whether a burst capture is currently in progress */
let captureReady   = true;

/** @type {ReturnType<typeof setInterval>|null} */
let heartbeatTimer = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Capture a single JPEG frame from the given video element.
 * Scales the frame down so its width never exceeds 540 px.
 *
 * @param {HTMLVideoElement} video
 * @returns {string|null} Base-64 encoded JPEG (no data-URL prefix), or null on failure.
 */
function captureFrame(video) {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;

  const canvas = document.createElement('canvas');
  const scale  = Math.min(1, 540 / video.videoWidth);
  canvas.width  = Math.round(video.videoWidth  * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // quality 0.6 ≈ 20-30 KB per frame — sufficient for AI vision
  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  return dataUrl.split(',')[1]; // base64 only, no "data:image/jpeg;base64," prefix
}

/**
 * Extract page metadata for context-enriched burst results.
 * @returns {{ url: string, timestamp: string, viewers: string|null, title: string, pageText: string|null }}
 */
function extractMeta() {
  return {
    url:       location.href,
    timestamp: new Date().toISOString(),
    viewers:   document.querySelector('[class*="viewer"], [class*="online-count"]')?.innerText?.trim() ?? null,
    title:     document.title,
    pageText:  document.querySelector('#guide-step-2')?.innerText?.trim()?.substring(0, 200) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Background messaging helpers
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget wrapper around chrome.runtime.sendMessage.
 * Swallows errors caused by extension context invalidation or background
 * service-worker restarts.
 *
 * @param {object} message
 */
function sendToBackground(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // Consume lastError to silence unchecked-error warnings in the console.
      void chrome.runtime.lastError;
    });
  } catch (err) {
    // Extension context may have been invalidated (e.g. update / reload).
    console.warn('[LiveWatch] sendToBackground failed:', err?.message);
    stopHeartbeat();
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/**
 * Start the 30-second heartbeat ticker.
 * Sends { type: HEARTBEAT, alive: <boolean> } reflecting whether the video is
 * still present in the DOM.
 */
function startHeartbeat() {
  if (heartbeatTimer !== null) return; // already running

  heartbeatTimer = setInterval(() => {
    const alive = document.querySelector('video') !== null;
    try {
      chrome.runtime.sendMessage({ type: MSG.HEARTBEAT, alive }, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {
      console.warn('[LiveWatch] Heartbeat send failed — stopping:', err?.message);
      stopHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the heartbeat ticker and clear the timer reference.
 */
function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Live detection
// ---------------------------------------------------------------------------

/**
 * Called once a live video element has been found in the DOM.
 * Stores a reference, notifies background, and starts the heartbeat.
 *
 * @param {HTMLVideoElement} videoEl
 */
function onLiveStarted(videoEl) {
  if (liveVideo === videoEl) return; // already tracking this element
  liveVideo = videoEl;
  console.info('[LiveWatch] LIVE_STARTED');
  sendToBackground({ type: MSG.LIVE_STARTED });
  startHeartbeat();
  initChatObserver();
}

/**
 * Called when the tracked video element has been removed from the DOM.
 * Notifies background and stops the heartbeat.
 */
function onLiveEnded() {
  if (liveVideo === null) return; // already cleaned up
  liveVideo = null;
  console.info('[LiveWatch] LIVE_ENDED');
  sendToBackground({ type: MSG.LIVE_ENDED });
  stopHeartbeat();
}

/**
 * Set up a MutationObserver that watches for <video> elements being added to
 * or removed from the DOM tree.  Also performs an immediate synchronous check
 * in case the video is already present when the content script loads (e.g.
 * on a page reload while streaming).
 */
function initLiveWatch() {
  // --- Immediate check (page reload / late injection) ---
  const existing = document.querySelector('video');
  if (existing) {
    onLiveStarted(/** @type {HTMLVideoElement} */ (existing));
  }

  // --- Ongoing DOM observation ---
  const observer = new MutationObserver(() => {
    const video = document.querySelector('video');

    if (video && liveVideo === null) {
      // A new video appeared.
      onLiveStarted(/** @type {HTMLVideoElement} */ (video));
    } else if (!video && liveVideo !== null) {
      // The tracked video disappeared.
      onLiveEnded();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Burst capture
// ---------------------------------------------------------------------------

/**
 * Capture FRAMES_PER_BURST frames with FRAME_GAP_MS delays between them.
 * Returns the collected frames (possibly fewer than requested if some fail)
 * together with page metadata.
 *
 * @returns {Promise<{ frames: string[], meta: object }|{ error: string }>}
 */
async function performCaptureBurst() {
  if (!liveVideo) {
    // Attempt a last-ditch querySelector in case our reference was lost.
    const fallback = document.querySelector('video');
    if (fallback) {
      liveVideo = /** @type {HTMLVideoElement} */ (fallback);
    } else {
      return { error: 'video_not_ready' };
    }
  }

  if (liveVideo.readyState < 2 || liveVideo.videoWidth === 0) {
    return { error: 'video_not_ready' };
  }

  const frames = [];

  for (let i = 0; i < FRAMES_PER_BURST; i++) {
    if (i > 0) {
      await sleep(FRAME_GAP_MS);
    }

    const frame = captureFrame(liveVideo);
    if (frame !== null) {
      frames.push(frame);
    }
    // If frame is null we silently skip rather than aborting the burst.
  }

  return { frames, meta: extractMeta() };
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Health-check ping from background
  if (message?.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'POLL_STATS') {
    pollStats()
      .then(result => sendResponse({ stats: result }))
      .catch(err => sendResponse({ error: String(err) }));
    return true; // keep channel open for async
  }

  if (message?.type !== MSG.CAPTURE_BURST) {
    // Not our message — don't intercept.
    return false;
  }

  if (!captureReady) {
    sendResponse({ error: 'capture_in_progress' });
    return false;
  }

  captureReady = false;

  performCaptureBurst()
    .then((result) => {
      sendResponse(result);
    })
    .catch((err) => {
      console.error('[LiveWatch] Burst capture error:', err);
      sendResponse({ error: String(err?.message ?? 'unknown_error') });
    })
    .finally(() => {
      captureReady = true;
    });

  // Return true to keep the message channel open while the async work completes.
  return true;
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

initLiveWatch();

// ---------------------------------------------------------------------------
// Phase 3: Stats polling (inlined constants)
// ---------------------------------------------------------------------------

const STATS_API_ROOM = '/api/v1/streamer_desktop/live_room_info/get';
const STATS_API_HOME = '/api/v1/streamer_desktop/home/info';
const STATS_GRID_SEL = '#guide-step-2';
const STATS_CARD_SEL = '[class*="metricCard"]';
const STATS_VAL_SEL  = '[class*="data--"] > div';
const STATS_LBL_SEL  = '[class*="name--"]';

// ---------------------------------------------------------------------------
// Phase 3: parseStatValue helper
// ---------------------------------------------------------------------------

/**
 * Parse a stat value string into a number.
 * Handles null/undefined, commas, Thai baht symbol ฿, K (×1000), M (×1000000).
 *
 * @param {string|null|undefined} str
 * @returns {number|null}
 */
function parseStatValue(str) {
  if (str == null) return null;
  const s = String(str).replace(/฿/g, '').replace(/,/g, '').trim();
  if (s === '' || s === '-') return null;
  const upper = s.toUpperCase();
  if (upper.endsWith('M')) {
    const base = parseFloat(upper.slice(0, -1));
    return isNaN(base) ? null : Math.round(base * 1_000_000);
  }
  if (upper.endsWith('K')) {
    const base = parseFloat(upper.slice(0, -1));
    return isNaN(base) ? null : Math.round(base * 1_000);
  }
  const parsed = parseFloat(s);
  return isNaN(parsed) ? null : Math.round(parsed);
}

// ---------------------------------------------------------------------------
// Phase 3: pollStats — fetch TikTok internal APIs with DOM fallback
// ---------------------------------------------------------------------------

/**
 * Poll live stats from TikTok internal APIs, falling back to DOM scraping.
 *
 * @returns {Promise<{
 *   viewer_count: number|null,
 *   like_count: number|null,
 *   room_status: number|null,
 *   gmv: string|null,
 *   units_sold: number|null,
 *   product_clicks: number|null,
 *   ctr: string|null,
 *   source: 'api'|'dom',
 *   ts: string
 * }>}
 */
async function pollStats() {
  const ts = new Date().toISOString();

  // Try both API endpoints in parallel
  try {
    const [roomRes, homeRes] = await Promise.all([
      fetch(STATS_API_ROOM, { credentials: 'include' }),
      fetch(STATS_API_HOME, { credentials: 'include' }),
    ]);

    if (roomRes.ok && homeRes.ok) {
      const [roomData, homeData] = await Promise.all([
        roomRes.json(),
        homeRes.json(),
      ]);

      // Extract fields from API responses (structure may vary; use optional chaining)
      const roomInfo = roomData?.data ?? roomData ?? {};
      const homeInfo = homeData?.data ?? homeData ?? {};

      const viewer_count   = roomInfo.user_count    ?? homeInfo.user_count    ?? null;
      const like_count     = roomInfo.like_count    ?? homeInfo.like_count    ?? null;
      const room_status    = roomInfo.room_status   ?? homeInfo.room_status   ?? null;
      const gmv            = homeInfo.gmv           ?? roomInfo.gmv           ?? null;
      const units_sold     = homeInfo.units_sold    ?? roomInfo.units_sold    ?? null;
      const product_clicks = homeInfo.product_clicks ?? roomInfo.product_clicks ?? null;
      const ctr            = homeInfo.ctr           ?? roomInfo.ctr           ?? null;

      return { viewer_count, like_count, room_status, gmv, units_sold, product_clicks, ctr, source: 'api', ts };
    }
  } catch (err) {
    console.warn('[LiveWatch] pollStats API fetch failed, falling back to DOM:', err?.message);
  }

  // DOM fallback
  return pollStatsDom(ts);
}

/**
 * Scrape stats from DOM metric cards when API is unavailable.
 *
 * @param {string} ts - ISO timestamp string
 * @returns {{
 *   viewer_count: number|null,
 *   like_count: number|null,
 *   room_status: null,
 *   gmv: string|null,
 *   units_sold: number|null,
 *   product_clicks: number|null,
 *   ctr: string|null,
 *   source: 'dom',
 *   ts: string
 * }}
 */
function pollStatsDom(ts) {
  let viewer_count   = null;
  let like_count     = null;
  let gmv            = null;
  let units_sold     = null;
  let product_clicks = null;
  let ctr            = null;

  try {
    const cards = document.querySelectorAll(STATS_CARD_SEL);
    cards.forEach((card) => {
      const labelEl = card.querySelector(STATS_LBL_SEL);
      const valueEl = card.querySelector(STATS_VAL_SEL);
      if (!labelEl || !valueEl) return;

      const label = labelEl.innerText?.trim() ?? '';
      const raw   = valueEl.innerText?.trim() ?? null;

      if (/GMV|ยอด/.test(label)) {
        // Preserve raw string for baht parsing in background
        gmv = raw;
      } else if (/ผู้ชม/.test(label)) {
        viewer_count = parseStatValue(raw);
      } else if (/ถูกใจ|like/i.test(label)) {
        like_count = parseStatValue(raw);
      } else if (/สินค้า.*ขาย|ขาย.*สินค้า/.test(label)) {
        units_sold = parseStatValue(raw);
      } else if (/คลิก/.test(label)) {
        product_clicks = parseStatValue(raw);
      } else if (/CTR|%/.test(label)) {
        // Preserve raw string for percentage parsing in background
        ctr = raw;
      }
    });
  } catch (err) {
    console.error('[LiveWatch] pollStatsDom error:', err);
  }

  return {
    viewer_count,
    like_count,
    room_status: null, // not available from DOM
    gmv,
    units_sold,
    product_clicks,
    ctr,
    source: 'dom',
    ts,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: Chat extraction (self-contained — no imports allowed in content.js)
// ---------------------------------------------------------------------------

/**
 * Start watching the TikTok Live chat feed for new messages.
 * Also registers the WebSocket message listener forwarded by injected.js.
 *
 * Safe to call multiple times — attaches only once via guard flag on window.
 */
function initChatObserver() {
  // Guard against multiple calls (e.g. if onLiveStarted fires more than once).
  if (window.__livewatchChatObserving) return;
  window.__livewatchChatObserving = true;

  // Register the WebSocket message handler from injected.js.
  window.addEventListener('__livewatch_ws_msg', handleWsMessage);

  // Try to find the chat feed element immediately.
  const feedEl = document.querySelector('#dashboard-guide-chat .overflow-y-hidden');
  if (feedEl) {
    attachChatObserver(feedEl);
    return;
  }

  // Not present yet — wait for it to appear in the DOM.
  const waitObserver = new MutationObserver(function () {
    const el = document.querySelector('#dashboard-guide-chat .overflow-y-hidden');
    if (!el) return;
    waitObserver.disconnect();
    attachChatObserver(el);
  });

  waitObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Attach a MutationObserver to the chat feed element that fires for every
 * newly added child node (i.e. each new chat message row).
 *
 * @param {Element} feedEl
 */
function attachChatObserver(feedEl) {
  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return; // element nodes only
        const result = extractChatNode(node);
        if (result === null) return;
        try {
          chrome.runtime.sendMessage({ type: 'CHAT_MSG', msg: result }, function () {
            void chrome.runtime.lastError;
          });
        } catch (err) {
          console.warn('[LiveWatch] attachChatObserver sendMessage failed:', err?.message);
        }
      });
    });
  });

  observer.observe(feedEl, { childList: true });
  console.info('[LiveWatch] Chat observer attached to feed element');
}

/**
 * Extract username and text from a chat message DOM node.
 *
 * @param {Element} node
 * @returns {{ ts: number, username: string|null, text: string, msg_type: string, raw_node: string }|null}
 */
function extractChatNode(node) {
  // Username — try several selector patterns used by TikTok Live
  const usernameEl =
    node.querySelector('[class*="userName"]') ||
    node.querySelector('[class*="username"]') ||
    node.querySelector('[class*="name--"]');
  const username = usernameEl ? (usernameEl.innerText?.trim() || null) : null;

  // Message text — try chat content selectors, fall back to full node text
  const textEl =
    node.querySelector('[class*="content"]') ||
    node.querySelector('[class*="text--"]') ||
    node.querySelector('[class*="comment"]');
  const text = textEl
    ? (textEl.innerText?.trim() || null)
    : (node.innerText?.trim() || null);

  if (!text) return null;

  return {
    ts:       Date.now(),
    username: username || null,
    text,
    msg_type: username ? 'comment' : 'system',
    raw_node: node.innerText?.trim()?.substring(0, 200) ?? '',
  };
}

/**
 * Handle a WebSocket message event forwarded by injected.js via CustomEvent.
 * Filters out binary frames and sends parseable JSON frames to background.js.
 *
 * @param {CustomEvent} event
 */
function handleWsMessage(event) {
  try {
    const data = event.detail && event.detail.data;
    if (!data || data === '__binary__') return;

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (_parseErr) {
      return; // not JSON — ignore
    }

    if (!parsed) return;
    // Only forward frames that look like TikTok chat payloads.
    if (!parsed.type && !parsed.messages) return;

    try {
      chrome.runtime.sendMessage({ type: 'WS_MSG', payload: event.detail }, function () {
        void chrome.runtime.lastError;
      });
    } catch (sendErr) {
      console.warn('[LiveWatch] handleWsMessage sendMessage failed:', sendErr?.message);
    }
  } catch (_e) {
    // Silently swallow — must not crash the page.
  }
}
