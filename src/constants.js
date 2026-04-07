/**
 * constants.js
 * Shared constants for LiveWatch extension (TikTok Shop Helper).
 * Used by background.js, content.js, popup.js, and settings.js.
 */

// ---------------------------------------------------------------------------
// External API endpoints
// ---------------------------------------------------------------------------

/** Pollinations OpenAI-compatible chat completions endpoint */
export const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

/** Vision-capable model hosted on Pollinations */
export const POLLINATIONS_MODEL = 'gemini-flash-lite-3.1';

// ---------------------------------------------------------------------------
// TikTok Live detection
// ---------------------------------------------------------------------------

/** Regex that matches the TikTok streamer live URL */
export const TIKTOK_LIVE_PATTERN = /shop\.tiktok\.com\/streamer\/live/;

// ---------------------------------------------------------------------------
// Capture / timing settings
// ---------------------------------------------------------------------------

/** How often (in minutes) to trigger a frame-capture burst via chrome.alarms */
export const CAPTURE_INTERVAL_MINUTES = 8;

/** Number of frames to capture in a single burst */
export const FRAMES_PER_BURST = 3;

/** Milliseconds to wait between consecutive frame captures in a burst */
export const FRAME_GAP_MS = 5000;

/** Milliseconds between heartbeat pings from content script to background */
export const HEARTBEAT_INTERVAL_MS = 30000;

/** Local hour (24-h) at which the daily summary alarm fires */
export const DAILY_SUMMARY_HOUR = 23;

// ---------------------------------------------------------------------------
// Alarm names
// ---------------------------------------------------------------------------

/** chrome.alarms name: periodic frame-capture burst */
export const ALARM_CAPTURE = 'captureBurst';

/** chrome.alarms name: end-of-day LINE summary */
export const ALARM_DAILY = 'dailySummary';

/** chrome.alarms name: scan open tabs for live page */
export const ALARM_SCAN = 'scanTabs';

// ---------------------------------------------------------------------------
// Extension status enum
// ---------------------------------------------------------------------------

/**
 * Possible operational statuses for the extension.
 * @type {{ OFFLINE: string, MONITORING: string, CAPTURING: string, ANALYZING: string }}
 */
export const STATUS = Object.freeze({
  OFFLINE: 'OFFLINE',
  MONITORING: 'MONITORING',
  CAPTURING: 'CAPTURING',
  ANALYZING: 'ANALYZING',
});

// ---------------------------------------------------------------------------
// Message type identifiers (chrome.runtime.sendMessage / postMessage)
// ---------------------------------------------------------------------------

/**
 * Message type constants used between background, content, and popup scripts.
 * @type {{ [key: string]: string }}
 */
export const MSG = Object.freeze({
  LIVE_STARTED: 'LIVE_STARTED',
  LIVE_ENDED: 'LIVE_ENDED',
  HEARTBEAT: 'HEARTBEAT',
  CAPTURE_BURST: 'CAPTURE_BURST',
  BURST_RESULT: 'BURST_RESULT',
  GET_STATUS: 'GET_STATUS',
  STATUS_RESPONSE: 'STATUS_RESPONSE',
});

// ---------------------------------------------------------------------------
// chrome.storage.local key names
// ---------------------------------------------------------------------------

/**
 * Keys used for chrome.storage.local persistence.
 * @type {{ CONFIG: string, STATE: string, LOGS: string }}
 */
export const STORAGE_KEYS = Object.freeze({
  CONFIG: 'config',
  STATE: 'extensionState',
  LOGS: 'localLogs',
});
