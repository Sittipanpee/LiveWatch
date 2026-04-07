/**
 * supabase.js
 * Thin Supabase REST API wrapper — uses fetch only, no SDK.
 * MV3 service workers cannot import external bundled SDKs.
 *
 * All functions return { data, error } to mimic the Supabase JS client shape.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read Supabase credentials from chrome.storage.local.
 * Expected keys: supabaseUrl, supabaseKey
 *
 * @returns {Promise<{ supabaseUrl: string, supabaseKey: string }>}
 * @throws {Error} if credentials are missing
 */
async function getConfig() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['supabaseUrl', 'supabaseKey'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const { supabaseUrl, supabaseKey } = result;
      if (!supabaseUrl || !supabaseKey) {
        reject(new Error('Supabase credentials not configured. Set supabaseUrl and supabaseKey in storage.'));
        return;
      }
      resolve({ supabaseUrl, supabaseKey });
    });
  });
}

/**
 * Build standard Supabase REST headers.
 *
 * @param {string} apiKey
 * @param {string} [prefer] - Supabase Prefer header value (e.g. 'return=representation')
 * @returns {HeadersInit}
 */
function buildHeaders(apiKey, prefer = '') {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': apiKey,
    'Authorization': `Bearer ${apiKey}`,
  };
  if (prefer) {
    headers['Prefer'] = prefer;
  }
  return headers;
}

/**
 * Convert a filters object into a URL query string for Supabase PostgREST.
 * Each key becomes a query param; values use PostgREST filter syntax.
 * Example: { date: 'eq.2026-04-06', status: 'eq.active' }
 *   → '?date=eq.2026-04-06&status=eq.active'
 *
 * @param {Record<string, string>} filters
 * @returns {string} - query string including leading '?' or ''
 */
function buildQueryString(filters) {
  if (!filters || Object.keys(filters).length === 0) return '';
  const params = new URLSearchParams(filters);
  return `?${params.toString()}`;
}

/**
 * Safely parse a fetch Response into { data, error }.
 *
 * @param {Response} response
 * @returns {Promise<{ data: any, error: string | null }>}
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
      (body && (body.message || body.error || body.hint)) ||
      `HTTP ${response.status}: ${response.statusText}`;
    return { data: null, error: message };
  }

  return { data: body, error: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Insert one row into a Supabase table.
 *
 * @param {string} table - Supabase table name
 * @param {Record<string, unknown>} row - Row data to insert
 * @returns {Promise<{ data: any, error: string | null }>}
 */
export async function supabaseInsert(table, row) {
  try {
    const { supabaseUrl, supabaseKey } = await getConfig();
    const url = `${supabaseUrl}/rest/v1/${table}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(supabaseKey, 'return=representation'),
      body: JSON.stringify(row),
    });

    return parseResponse(response);
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * Select rows from a Supabase table with optional PostgREST filters.
 *
 * @param {string} table - Supabase table name
 * @param {Record<string, string>} [filters] - Filter object, e.g. { summary_date: 'eq.2026-04-06' }
 * @returns {Promise<{ data: any[], error: string | null }>}
 */
export async function supabaseSelect(table, filters = {}) {
  try {
    const { supabaseUrl, supabaseKey } = await getConfig();
    const qs = buildQueryString(filters);
    const url = `${supabaseUrl}/rest/v1/${table}${qs}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(supabaseKey),
    });

    return parseResponse(response);
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * Update rows in a Supabase table that match the given filter conditions.
 *
 * @param {string} table - Supabase table name
 * @param {Record<string, string>} match - PostgREST filter params to identify rows
 * @param {Record<string, unknown>} updates - Column values to update
 * @returns {Promise<{ data: any, error: string | null }>}
 */
export async function supabaseUpdate(table, match, updates) {
  try {
    const { supabaseUrl, supabaseKey } = await getConfig();
    const qs = buildQueryString(match);
    const url = `${supabaseUrl}/rest/v1/${table}${qs}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: buildHeaders(supabaseKey, 'return=representation'),
      body: JSON.stringify(updates),
    });

    return parseResponse(response);
  } catch (err) {
    return { data: null, error: err.message };
  }
}
