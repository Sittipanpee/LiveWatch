/**
 * sheets.js — Google Sheets API v4 REST wrapper for LiveWatch
 *
 * Spreadsheet structure:
 *   Sheet "sessions"       — one row per live session
 *   Sheet "analysis_logs"  — one row per capture burst
 *   Sheet "stats_timeline" — one row per 30 s stats poll
 *   Sheet "chat_logs"      — one row per chat message
 *
 * All exported functions return { data, error } — same shape as supabase.js.
 * Auth tokens are managed by callers; sheetsAppend/sheetsAppendBatch accept
 * a token parameter rather than fetching one internally.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHEETS_API        = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API         = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API  = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FOLDER_NAME = 'LiveWatch';

// OAuth client_id and scopes are declared in manifest.json `oauth2` block.
// chrome.identity.getAuthToken handles caching and silent refresh internally.

/**
 * Sheet names and their column headers in insertion order.
 * Row values must be provided in this exact order.
 */
const SHEET_SCHEMAS = Object.freeze({
  sessions: [
    'id', 'started_at', 'ended_at', 'duration_mins', 'tab_url',
    'peak_viewers', 'final_gmv_satang', 'final_units_sold',
    'room_status', 'line_summary_sent_at',
  ],
  analysis_logs: [
    'id', 'session_id', 'captured_at', 'phone_detected',
    'eye_contact_score', 'smile_score', 'product_presenting',
    'presenter_visible', 'energy_level', 'engagement_score',
    'lighting_quality', 'activity_summary', 'alert_flag', 'thumbnail_url',
  ],
  stats_timeline: [
    'id', 'session_id', 'polled_at', 'viewer_count', 'like_count',
    'gmv_satang', 'units_sold', 'product_clicks', 'ctr_bps',
    'room_status', 'source',
  ],
  chat_logs: [
    'id', 'session_id', 'ts', 'username', 'text', 'msg_type',
  ],
});

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Convert a row object to an ordered array matching SHEET_SCHEMAS[sheetName].
 * Missing keys become empty string. Booleans become 'TRUE' / 'FALSE'.
 *
 * @param {string} sheetName
 * @param {Record<string, unknown>} obj
 * @returns {(string|number)[]}
 */
function rowToArray(sheetName, obj) {
  const columns = SHEET_SCHEMAS[sheetName];
  if (!columns) return [];

  return columns.map((col) => {
    const val = obj[col];
    if (val === undefined || val === null) return '';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    return val;
  });
}

/**
 * Build an Authorization header object for Google API calls.
 *
 * @param {string} token
 * @returns {HeadersInit}
 */
function authHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Safely parse a fetch Response into { data, error }.
 *
 * @param {Response} response
 * @returns {Promise<{ data: any, error: string|null }>}
 */
async function parseResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      (body && (body.error?.message || body.error || body.message)) ||
      `HTTP ${response.status}: ${response.statusText}`;
    return { data: null, error: message };
  }

  return { data: body, error: null };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Obtain a Google OAuth2 token via chrome.identity.getAuthToken.
 * Chrome handles caching and silent refresh internally — there is no
 * 1-hour expiry to manage. Non-throwing — returns null on failure.
 *
 * @param {boolean} [interactive=false] - Show consent screen if needed
 * @returns {Promise<string|null>}
 */
export async function getAuthToken(interactive = false) {
  try {
    return await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          console.warn('[LiveWatch] getAuthToken error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(token ?? null);
      });
    });
  } catch (e) {
    console.warn('[LiveWatch] getAuthToken unhandled error:', e);
    return null;
  }
}

/**
 * Revoke a Google OAuth2 token and remove it from Chrome's identity cache.
 *
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function revokeAuthToken(token) {
  if (!token) return;

  try {
    await new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`);
  } catch (e) {
    console.warn('[LiveWatch] revokeAuthToken error:', e);
  }
}

// ---------------------------------------------------------------------------
// Spreadsheet helpers
// ---------------------------------------------------------------------------

/**
 * Return the spreadsheetId from config if already set, otherwise null.
 *
 * @param {{ sheetsId?: string }} config
 * @returns {string|null}
 */
export function getSpreadsheetsId(config) {
  return config?.sheetsId ?? null;
}

/**
 * Create a new Google Spreadsheet with one sheet per SHEET_SCHEMAS entry,
 * including header rows.
 *
 * @param {string} token - OAuth2 bearer token
 * @param {string} [title='LiveWatch Data']
 * @returns {Promise<{ data: { spreadsheetId: string, spreadsheetUrl: string }|null, error: string|null }>}
 */
export async function createSpreadsheet(token, title = 'LiveWatch Data') {
  try {
    if (!token) return { data: null, error: 'No auth token provided' };

    const sheets = Object.entries(SHEET_SCHEMAS).map(([sheetName, headers]) => ({
      properties: { title: sheetName },
      data: [{
        rowData: [{
          values: headers.map((h) => ({
            userEnteredValue: { stringValue: h },
          })),
        }],
      }],
    }));

    const body = {
      properties: { title },
      sheets,
    };

    const response = await fetch(SHEETS_API, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });

    const { data, error } = await parseResponse(response);
    if (error) return { data: null, error };

    return {
      data: {
        spreadsheetId: data.spreadsheetId,
        spreadsheetUrl: data.spreadsheetUrl,
      },
      error: null,
    };
  } catch (e) {
    console.error('[LiveWatch] createSpreadsheet error:', e);
    return { data: null, error: String(e) };
  }
}

/**
 * Append a single row to the named sheet.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {Record<string, unknown>} row
 * @param {string} token - OAuth2 bearer token
 * @returns {Promise<{ data: any, error: string|null }>}
 */
export async function sheetsAppend(spreadsheetId, sheetName, row, token) {
  try {
    if (!token) return { data: null, error: 'No auth token provided' };

    const values = [rowToArray(sheetName, row)];
    const range = encodeURIComponent(`${sheetName}!A1`);
    const url = `${SHEETS_API}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ values }),
    });

    return parseResponse(response);
  } catch (e) {
    console.error(`[LiveWatch] sheetsAppend(${sheetName}) error:`, e);
    return { data: null, error: String(e) };
  }
}

/**
 * Append multiple rows to the named sheet in a single API call.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {Record<string, unknown>[]} rows
 * @param {string} token - OAuth2 bearer token
 * @returns {Promise<{ data: any, error: string|null }>}
 */
export async function sheetsAppendBatch(spreadsheetId, sheetName, rows, token) {
  try {
    if (!token) return { data: null, error: 'No auth token provided' };
    if (!rows || rows.length === 0) return { data: null, error: 'No rows provided' };

    const values = rows.map((r) => rowToArray(sheetName, r));
    const range = encodeURIComponent(`${sheetName}!A1`);
    const url = `${SHEETS_API}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ values }),
    });

    return parseResponse(response);
  } catch (e) {
    console.error(`[LiveWatch] sheetsAppendBatch(${sheetName}) error:`, e);
    return { data: null, error: String(e) };
  }
}

/**
 * Clear all data rows in a sheet (preserves the header row in row 1).
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {string} token - OAuth2 bearer token
 * @returns {Promise<{ data: any, error: string|null }>}
 */
export async function sheetsClear(spreadsheetId, sheetName, token) {
  try {
    if (!token) return { data: null, error: 'No auth token provided' };

    const range = encodeURIComponent(`${sheetName}!A2:ZZ`);
    const url = `${SHEETS_API}/${spreadsheetId}/values/${range}:clear`;

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });

    return parseResponse(response);
  } catch (e) {
    console.error(`[LiveWatch] sheetsClear(${sheetName}) error:`, e);
    return { data: null, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Google Drive storage helpers
// ---------------------------------------------------------------------------

/**
 * Find or create the 'LiveWatch/frames' folder hierarchy in Google Drive.
 * Returns folderId of the inner 'frames' folder, or null on error.
 *
 * Drive folder structure created:
 *   My Drive/
 *     LiveWatch/
 *       frames/
 *
 * @param {string} token - OAuth2 bearer token
 * @returns {Promise<string|null>}
 */
export async function getOrCreateDriveFolder(token) {
  if (!token) return null;

  try {
    // ── Step 1: Find or create the 'LiveWatch' root folder ──────────────────
    const rootId = await _findOrCreateFolder(token, DRIVE_FOLDER_NAME, null);
    if (!rootId) return null;

    // ── Step 2: Find or create the 'frames' subfolder ───────────────────────
    const framesId = await _findOrCreateFolder(token, 'frames', rootId);
    return framesId;
  } catch (e) {
    console.error('[LiveWatch] getOrCreateDriveFolder error:', e);
    return null;
  }
}

/**
 * Upload a JPEG frame to Google Drive using multipart/related upload.
 * After upload, grants public read-only access (anyone with link).
 *
 * @param {string} base64Jpeg - Base64-encoded JPEG data (no data URL prefix)
 * @param {string} filename - e.g. '{sessionId}_{timestamp}.jpg'
 * @param {string} folderId - Drive folder ID to upload into
 * @param {string} token - OAuth2 bearer token
 * @returns {Promise<{ webViewLink: string, id: string }|null>}
 */
export async function uploadFrameToDrive(base64Jpeg, filename, folderId, token) {
  if (!base64Jpeg || !folderId || !token) return null;

  try {
    // Convert base64 → Uint8Array
    const binary = atob(base64Jpeg);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Build multipart/related body: metadata part + media part
    const boundary = 'livewatch_boundary_' + Date.now();
    const metadata = JSON.stringify({
      name: filename,
      mimeType: 'image/jpeg',
      parents: [folderId],
    });

    // Encode metadata as UTF-8 bytes
    const encoder = new TextEncoder();
    const metaPart = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    );
    const mediaPart = encoder.encode(
      `--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`
    );
    const closing = encoder.encode(`\r\n--${boundary}--`);

    // Concatenate all parts
    const bodyParts = [metaPart, mediaPart, bytes, closing];
    const totalLength = bodyParts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of bodyParts) {
      body.set(part, offset);
      offset += part.length;
    }

    const uploadUrl = `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,webViewLink`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(totalLength),
      },
      body: body.buffer,
    });

    if (!uploadRes.ok) {
      const detail = await uploadRes.text().catch(() => String(uploadRes.status));
      console.error('[LiveWatch] uploadFrameToDrive upload failed:', uploadRes.status, detail.slice(0, 200));
      return { id: null, status: uploadRes.status, error: detail.slice(0, 200), webViewLink: null };
    }

    const fileData = await uploadRes.json();
    const fileId   = fileData.id;

    // PDPA: do NOT grant public access. Files remain private to the owner.
    // webViewLink still works for the owner when signed into Drive.
    return {
      id: fileId,
      status: uploadRes.status,
      webViewLink: fileData.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    };
  } catch (e) {
    console.error('[LiveWatch] uploadFrameToDrive error:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drive private helpers
// ---------------------------------------------------------------------------

/**
 * Search for a folder by name (optionally scoped to a parent), creating it
 * if it does not exist. Returns the folder ID or null on error.
 *
 * @param {string} token
 * @param {string} name
 * @param {string|null} parentId
 * @returns {Promise<string|null>}
 */
async function _findOrCreateFolder(token, name, parentId) {
  try {
    const parentClause = parentId ? ` and '${parentId}' in parents` : '';
    const q = encodeURIComponent(
      `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`
    );
    const listUrl = `${DRIVE_API}?q=${q}&fields=files(id,name)&pageSize=1`;

    const listRes = await fetch(listUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!listRes.ok) {
      console.error('[LiveWatch] _findOrCreateFolder list error:', listRes.status);
      return null;
    }

    const listData = await listRes.json();
    if (listData.files && listData.files.length > 0) {
      return listData.files[0].id;
    }

    // Not found — create it
    const createBody = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) createBody.parents = [parentId];

    const createRes = await fetch(DRIVE_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      console.error('[LiveWatch] _findOrCreateFolder create error:', createRes.status);
      return null;
    }

    const created = await createRes.json();
    return created.id ?? null;
  } catch (e) {
    console.error('[LiveWatch] _findOrCreateFolder error:', e);
    return null;
  }
}
