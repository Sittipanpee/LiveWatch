'use strict';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const STORAGE_KEYS = [
  'pollinationsKey',
  'supabaseUrl',
  'supabaseKey',
  'captureInterval',
  'summaryHour',
];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const apiBaseEl        = document.getElementById('apiBase');
const apiTokenEl       = document.getElementById('apiToken');
const testApiBtn       = document.getElementById('testApi');
const apiStatusEl      = document.getElementById('apiStatus');
const pollinationsKeyEl  = document.getElementById('pollinationsKey');
const supabaseUrlEl      = document.getElementById('supabaseUrl');
const supabaseKeyEl    = document.getElementById('supabaseKey');
const captureIntervalEl = document.getElementById('captureInterval');
const captureIntervalDisplay = document.getElementById('captureIntervalDisplay');
const summaryHourEl    = document.getElementById('summaryHour');

const saveBtn              = document.getElementById('saveBtn');
const testSupabaseBtn      = document.getElementById('testSupabaseBtn');
const testPollinationsBtn  = document.getElementById('testPollinationsBtn');
const setupStorageBtn      = document.getElementById('setupStorageBtn');

const supabaseTestResult     = document.getElementById('supabaseTestResult');
const pollinationsTestResult = document.getElementById('pollinationsTestResult');

const toastEl = document.getElementById('toast');
const tierNoteEl = document.getElementById('tierNote');

// Tier limits — must match src/tier.js and SaaS backend.
const TIER_LIMITS = {
  gold:     { maxPerHour: 3,  minIntervalMinutes: 20 },
  platinum: { maxPerHour: 6,  minIntervalMinutes: 10 },
  diamond:  { maxPerHour: 12, minIntervalMinutes: 5  },
};

let currentTierMin = 20; // default to gold (most restrictive)
let currentTierName = 'gold';

/**
 * Read cached tier from storage and apply UI constraints to the
 * captureInterval slider (note text + min attribute).
 */
function applyTierConstraints() {
  chrome.storage.local.get('userTier', (items) => {
    if (chrome.runtime.lastError) return;
    const cached = items.userTier;
    if (cached && TIER_LIMITS[cached.tier]) {
      currentTierName = cached.tier;
      currentTierMin = cached.minIntervalMinutes ?? TIER_LIMITS[cached.tier].minIntervalMinutes;
    } else {
      currentTierName = 'gold';
      currentTierMin = TIER_LIMITS.gold.minIntervalMinutes;
    }

    if (tierNoteEl) {
      tierNoteEl.innerHTML =
        `Your <b>${currentTierName}</b> plan allows a minimum of ${currentTierMin} minutes between captures.`;
    }

    if (captureIntervalEl) {
      const newMin = Math.max(6, currentTierMin);
      captureIntervalEl.min = String(newMin);
      if (Number(captureIntervalEl.value) < newMin) {
        captureIntervalEl.value = String(newMin);
        if (captureIntervalDisplay) {
          captureIntervalDisplay.textContent = String(newMin);
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;

/**
 * Show a toast message at the bottom of the page for `durationMs` ms.
 *
 * @param {string} message
 * @param {number} [durationMs=2000]
 */
function showToast(message, durationMs = 2000) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  toastEl.textContent = message;
  toastEl.classList.add('visible');

  toastTimer = setTimeout(() => {
    toastEl.classList.remove('visible');
    toastTimer = null;
  }, durationMs);
}

// ---------------------------------------------------------------------------
// Test result helpers
// ---------------------------------------------------------------------------

/**
 * Render a success or error badge inside a container element.
 *
 * @param {HTMLElement} container
 * @param {'success'|'error'} type
 * @param {string} message
 */
function showTestResult(container, type, message) {
  const badge = document.createElement('div');
  badge.className = `test-result ${type}`;
  badge.textContent = type === 'success' ? `✓ ${message}` : `✗ ${message}`;

  container.innerHTML = '';
  container.appendChild(badge);
}

function clearTestResult(container) {
  container.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Load settings from chrome.storage.local
// ---------------------------------------------------------------------------

function loadSettings() {
  chrome.storage.local.get(STORAGE_KEYS, (items) => {
    if (chrome.runtime.lastError) {
      console.error('[Settings] Failed to load:', chrome.runtime.lastError.message);
      return;
    }

    if (items.pollinationsKey) pollinationsKeyEl.value = items.pollinationsKey;
    if (items.supabaseUrl)     supabaseUrlEl.value     = items.supabaseUrl;
    if (items.supabaseKey)     supabaseKeyEl.value     = items.supabaseKey;

    const interval = items.captureInterval != null ? Number(items.captureInterval) : 8;
    captureIntervalEl.value = interval;
    captureIntervalDisplay.textContent = interval;

    const hour = items.summaryHour != null ? String(items.summaryHour) : '23';
    const opt = summaryHourEl.querySelector(`option[value="${hour}"]`);
    if (opt) opt.selected = true;
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Save settings — partial saves allowed; only non-empty fields are persisted
// so users can configure one section at a time without losing other values.
// ---------------------------------------------------------------------------

function saveSettings() {
  const fields = {
    pollinationsKey: pollinationsKeyEl.value.trim(),
    supabaseUrl:     normaliseUrl(supabaseUrlEl.value.trim()),
    supabaseKey:     supabaseKeyEl.value.trim(),
  };

  // Only persist fields the user actually entered
  const data = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value) data[key] = value;
  }

  // Numeric fields always saved (have defaults from <select>)
  let intervalVal = Number(captureIntervalEl.value);
  if (intervalVal < currentTierMin) {
    showToast(`Plan minimum is ${currentTierMin} minutes`, 3000);
    intervalVal = currentTierMin;
    captureIntervalEl.value = String(currentTierMin);
    if (captureIntervalDisplay) captureIntervalDisplay.textContent = String(currentTierMin);
  }
  data.captureInterval = intervalVal;
  data.summaryHour     = Number(summaryHourEl.value);

  saveBtn.disabled = true;

  chrome.storage.local.set(data, () => {
    saveBtn.disabled = false;

    if (chrome.runtime.lastError) {
      showToast('เกิดข้อผิดพลาด: ' + chrome.runtime.lastError.message, 3500);
      return;
    }

    showToast('บันทึกแล้ว ✓');
  });
}

// ---------------------------------------------------------------------------
// Connect LiveWatch Account (SaaS API)
// ---------------------------------------------------------------------------

function loadApiConfig() {
  chrome.storage.local.get('config', (items) => {
    if (chrome.runtime.lastError) return;
    const config = items.config ?? {};
    if (config.apiBase) apiBaseEl.value = config.apiBase;
    if (config.apiToken) apiTokenEl.value = config.apiToken;
  });
}

async function testApiConnection() {
  const apiBase = apiBaseEl.value.trim().replace(/\/$/, '');
  const apiToken = apiTokenEl.value.trim();
  if (!apiToken) {
    apiStatusEl.textContent = '❌ กรุณากรอก API Token';
    apiStatusEl.style.color = '#991b1b';
    return;
  }
  apiStatusEl.textContent = '⏳ กำลังทดสอบ...';
  apiStatusEl.style.color = '#6b7280';
  testApiBtn.disabled = true;
  try {
    const res = await fetch(`${apiBase}/api/user/tier`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (res.status === 401) {
      apiStatusEl.textContent = '❌ Token ไม่ถูกต้อง';
      apiStatusEl.style.color = '#991b1b';
      return;
    }
    if (!res.ok) {
      apiStatusEl.textContent = `❌ Error ${res.status}`;
      apiStatusEl.style.color = '#991b1b';
      return;
    }
    const tier = await res.json();
    apiStatusEl.textContent = `✅ เชื่อมต่อสำเร็จ • Tier: ${tier.tier} • Min interval: ${tier.minIntervalMinutes} min`;
    apiStatusEl.style.color = '#065f46';

    const { config = {} } = await chrome.storage.local.get('config');
    await chrome.storage.local.set({
      config: { ...config, apiBase, apiToken },
      userTier: {
        tier: tier.tier,
        maxPerHour: tier.maxCapturesPerHour,
        minIntervalMinutes: tier.minIntervalMinutes,
        fetchedAt: Date.now(),
      },
    });
    if (typeof applyTierConstraints === 'function') applyTierConstraints();
  } catch (e) {
    apiStatusEl.textContent = `❌ ${e.message}`;
    apiStatusEl.style.color = '#991b1b';
  } finally {
    testApiBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Test Pollinations API key
// ---------------------------------------------------------------------------

async function testPollinations() {
  const key = pollinationsKeyEl.value.trim();
  if (!key) {
    showTestResult(pollinationsTestResult, 'error', 'กรุณากรอก API Key ก่อนทดสอบ');
    return;
  }

  testPollinationsBtn.disabled = true;
  clearTestResult(pollinationsTestResult);

  try {
    const res = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gemini-flash-lite-3.1',
        messages: [{ role: 'user', content: 'reply: {"ok":true}' }],
        temperature: 0,
        max_tokens: 20,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      showTestResult(pollinationsTestResult, 'success', `เชื่อมต่อสำเร็จ — model: ${data.model ?? 'gemini-flash-lite-3.1'}`);
    } else {
      const detail = await res.text().catch(() => String(res.status));
      showTestResult(pollinationsTestResult, 'error', `ผิดพลาด (${res.status}): ${detail.slice(0, 80)}`);
    }
  } catch (err) {
    showTestResult(pollinationsTestResult, 'error', `เชื่อมต่อไม่ได้: ${err.message}`);
  } finally {
    testPollinationsBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Setup Supabase Storage bucket
// ---------------------------------------------------------------------------

async function setupStorageBucket() {
  const rawUrl = supabaseUrlEl.value.trim();
  const key    = supabaseKeyEl.value.trim();

  if (!rawUrl || !key) {
    showTestResult(supabaseTestResult, 'error', 'กรุณากรอก URL และ Key ก่อน');
    return;
  }

  const baseUrl = normaliseUrl(rawUrl);
  setupStorageBtn.disabled = true;
  clearTestResult(supabaseTestResult);

  try {
    // Try to create the bucket (public: true so LINE can fetch images)
    const res = await fetch(`${baseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'livewatch-frames', name: 'livewatch-frames', public: true }),
    });

    if (res.ok) {
      showTestResult(supabaseTestResult, 'success', 'สร้าง Storage Bucket สำเร็จ — รูปภาพจะถูกส่งใน LINE แล้ว');
    } else {
      const text = await res.text();
      // 409 = already exists, which is fine
      if (res.status === 409 || text.includes('already exists') || text.includes('duplicate')) {
        // Bucket exists — make sure it's public by updating it
        await fetch(`${baseUrl}/storage/v1/bucket/livewatch-frames`, {
          method: 'PUT',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ public: true }),
        });
        showTestResult(supabaseTestResult, 'success', 'Storage Bucket มีอยู่แล้ว และตั้งค่า Public แล้ว ✓');
      } else {
        showTestResult(supabaseTestResult, 'error', `สร้างไม่สำเร็จ (${res.status}): ${text.slice(0, 80)}`);
      }
    }
  } catch (err) {
    showTestResult(supabaseTestResult, 'error', `เชื่อมต่อไม่ได้: ${err.message}`);
  } finally {
    setupStorageBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Test Supabase connection
// ---------------------------------------------------------------------------

async function testSupabase() {
  const rawUrl = supabaseUrlEl.value.trim();
  const key    = supabaseKeyEl.value.trim();

  if (!rawUrl || !key) {
    showTestResult(supabaseTestResult, 'error', 'กรุณากรอก URL และ Anon Key ก่อนทดสอบ');
    return;
  }

  const baseUrl = normaliseUrl(rawUrl);
  const healthUrl = `${baseUrl}/rest/v1/`;

  testSupabaseBtn.disabled = true;
  clearTestResult(supabaseTestResult);

  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    });

    // Supabase REST root returns 200 or 400 (schema listing) — both mean the
    // project is reachable and the key is accepted. 401/403 means bad key.
    if (res.status === 200 || res.status === 400) {
      showTestResult(supabaseTestResult, 'success', 'เชื่อมต่อสำเร็จ');
    } else if (res.status === 401 || res.status === 403) {
      showTestResult(supabaseTestResult, 'error', `Anon Key ไม่ถูกต้อง (${res.status})`);
    } else {
      showTestResult(supabaseTestResult, 'error', `ตอบกลับ (${res.status}) — ตรวจสอบ URL`);
    }
  } catch (err) {
    showTestResult(supabaseTestResult, 'error', `เชื่อมต่อไม่ได้: ${err.message}`);
  } finally {
    testSupabaseBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Strip trailing slash from a URL string.
 *
 * @param {string} url
 * @returns {string}
 */
function normaliseUrl(url) {
  return url.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Google Sheets section
// ---------------------------------------------------------------------------

const sheetStatusEl      = document.getElementById('sheets-status');
const btnSheetsConnect   = document.getElementById('btn-sheets-connect');
const btnSheetsDisconnect = document.getElementById('btn-sheets-disconnect');
const btnSheetsCreate    = document.getElementById('btn-sheets-create');
const btnSheetsSaveId    = document.getElementById('btn-sheets-save-id');
const sheetsIdEl         = document.getElementById('sheets-id');

/**
 * Reflect current Sheets connection state in the UI.
 */
async function initSheetsSection() {
  chrome.storage.local.get(['config'], (items) => {
    if (chrome.runtime.lastError) {
      console.error('[Settings] initSheetsSection failed:', chrome.runtime.lastError.message);
      return;
    }

    const config = items.config ?? {};

    if (config.sheetsConnected) {
      sheetStatusEl.textContent = 'เชื่อมต่อแล้ว ✅';
      sheetStatusEl.style.color = '#065f46';
      btnSheetsConnect.style.display = 'none';
      btnSheetsDisconnect.style.display = '';
    } else {
      sheetStatusEl.textContent = 'ไม่ได้เชื่อมต่อ';
      sheetStatusEl.style.color = '#6b7280';
      btnSheetsConnect.style.display = '';
      btnSheetsDisconnect.style.display = 'none';
    }

    if (config.sheetsId) {
      sheetsIdEl.value = config.sheetsId;
    }
  });
}

// ---------------------------------------------------------------------------
// Google OAuth (launchWebAuthFlow) — keep in sync with src/sheets.js
// ---------------------------------------------------------------------------

const OAUTH_CLIENT_ID = '437889543814-7n8n7t80f83rfl5kmjacae7v68hr42i2.apps.googleusercontent.com';
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];
const TOKEN_STORAGE_KEY = 'googleOAuthToken';

async function getGoogleAuthToken(interactive = true) {
  // Check cache first
  try {
    const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
    const entry = result[TOKEN_STORAGE_KEY];
    if (entry && entry.token && entry.expiresAt && Date.now() < entry.expiresAt - 60_000) {
      return entry.token;
    }
  } catch {}

  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(OAUTH_SCOPES.join(' '))}` +
    `&prompt=consent`;

  const responseUrl = await new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (url) => {
      if (chrome.runtime.lastError) {
        console.warn('[Settings] launchWebAuthFlow error:', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(url ?? null);
    });
  });

  if (!responseUrl) return null;
  const hash = responseUrl.split('#')[1] ?? '';
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') ?? '3600', 10);
  if (!token) return null;

  await chrome.storage.local.set({
    [TOKEN_STORAGE_KEY]: { token, expiresAt: Date.now() + expiresIn * 1000 },
  });
  return token;
}

/**
 * Request an interactive OAuth2 token and mark Sheets as connected.
 */
async function handleSheetsConnect() {
  btnSheetsConnect.disabled = true;
  sheetStatusEl.textContent = 'กำลังเชื่อมต่อ...';
  sheetStatusEl.style.color = '#6b7280';

  try {
    const token = await getGoogleAuthToken(true);

    if (!token) {
      sheetStatusEl.textContent = 'เชื่อมต่อไม่สำเร็จ ✗';
      sheetStatusEl.style.color = '#991b1b';
      btnSheetsConnect.disabled = false;
      return;
    }

    chrome.storage.local.get(['config'], (items) => {
      if (chrome.runtime.lastError) {
        console.error('[Settings] handleSheetsConnect storage get error:', chrome.runtime.lastError.message);
        return;
      }
      const config = { ...(items.config ?? {}), sheetsConnected: true };
      chrome.storage.local.set({ config }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Settings] handleSheetsConnect storage set error:', chrome.runtime.lastError.message);
          return;
        }
        sheetStatusEl.textContent = 'เชื่อมต่อแล้ว ✅';
        sheetStatusEl.style.color = '#065f46';
        btnSheetsConnect.style.display = 'none';
        btnSheetsDisconnect.style.display = '';
        btnSheetsConnect.disabled = false;
        showToast('เชื่อมต่อ Google Sheets แล้ว ✓');
      });
    });
  } catch (e) {
    console.error('[Settings] handleSheetsConnect error:', e);
    sheetStatusEl.textContent = 'เกิดข้อผิดพลาด ✗';
    sheetStatusEl.style.color = '#991b1b';
    btnSheetsConnect.disabled = false;
  }
}

/**
 * Revoke the cached token and clear Sheets config from storage.
 */
async function handleSheetsDisconnect() {
  btnSheetsDisconnect.disabled = true;

  try {
    // Retrieve cached token from storage and revoke
    let token = null;
    try {
      const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
      token = result[TOKEN_STORAGE_KEY]?.token ?? null;
    } catch {}

    await chrome.storage.local.remove(TOKEN_STORAGE_KEY);

    if (token) {
      // Best-effort server-side revocation
      fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`)
        .catch((e) => console.warn('[Settings] token revoke fetch error:', e));
    }

    chrome.storage.local.get(['config'], (items) => {
      if (chrome.runtime.lastError) {
        console.error('[Settings] handleSheetsDisconnect storage get error:', chrome.runtime.lastError.message);
        return;
      }
      const { sheetsConnected: _c, sheetsId: _i, ...rest } = items.config ?? {};
      chrome.storage.local.set({ config: rest }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Settings] handleSheetsDisconnect storage set error:', chrome.runtime.lastError.message);
          return;
        }
        sheetStatusEl.textContent = 'ไม่ได้เชื่อมต่อ';
        sheetStatusEl.style.color = '#6b7280';
        btnSheetsConnect.style.display = '';
        btnSheetsDisconnect.style.display = 'none';
        btnSheetsDisconnect.disabled = false;
        sheetsIdEl.value = '';
        showToast('ยกเลิกการเชื่อมต่อแล้ว');
      });
    });
  } catch (e) {
    console.error('[Settings] handleSheetsDisconnect error:', e);
    btnSheetsDisconnect.disabled = false;
  }
}

/**
 * Create a new LiveWatch spreadsheet via the Sheets API and save its ID.
 */
async function handleSheetsCreate() {
  btnSheetsCreate.disabled = true;
  showToast('กำลังสร้าง Spreadsheet...', 4000);

  try {
    const token = await getGoogleAuthToken(true);

    if (!token) {
      showToast('ไม่สามารถรับ token ได้ ✗', 3000);
      btnSheetsCreate.disabled = false;
      return;
    }

    // Sheet schemas for header rows
    const SHEET_SCHEMAS = {
      sessions: ['id','started_at','ended_at','duration_mins','tab_url','peak_viewers','final_gmv_satang','final_units_sold','room_status','line_summary_sent_at'],
      analysis_logs: ['id','session_id','captured_at','phone_detected','eye_contact_score','smile_score','product_presenting','presenter_visible','energy_level','engagement_score','lighting_quality','activity_summary','alert_flag','thumbnail_url'],
      stats_timeline: ['id','session_id','polled_at','viewer_count','like_count','gmv_satang','units_sold','product_clicks','ctr_bps','room_status','source'],
      chat_logs: ['id','session_id','ts','username','text','msg_type'],
    };

    const sheets = Object.entries(SHEET_SCHEMAS).map(([sheetName, headers]) => ({
      properties: { title: sheetName },
      data: [{
        rowData: [{
          values: headers.map((h) => ({ userEnteredValue: { stringValue: h } })),
        }],
      }],
    }));

    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: { title: 'LiveWatch Data' }, sheets }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => String(res.status));
      showToast(`สร้างไม่สำเร็จ (${res.status}): ${detail.slice(0, 60)}`, 4000);
      btnSheetsCreate.disabled = false;
      return;
    }

    const data = await res.json();
    const spreadsheetId  = data.spreadsheetId;
    const spreadsheetUrl = data.spreadsheetUrl;

    sheetsIdEl.value = spreadsheetId;

    chrome.storage.local.get(['config'], (items) => {
      if (chrome.runtime.lastError) {
        console.error('[Settings] handleSheetsCreate storage get error:', chrome.runtime.lastError.message);
        return;
      }
      const config = { ...(items.config ?? {}), sheetsId: spreadsheetId, sheetsConnected: true };
      chrome.storage.local.set({ config }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Settings] handleSheetsCreate storage set error:', chrome.runtime.lastError.message);
          return;
        }
        sheetStatusEl.textContent = 'เชื่อมต่อแล้ว ✅';
        sheetStatusEl.style.color = '#065f46';
        btnSheetsConnect.style.display = 'none';
        btnSheetsDisconnect.style.display = '';
        btnSheetsCreate.disabled = false;
        showToast(`สร้างสำเร็จ! เปิด: ${spreadsheetUrl}`, 5000);
      });
    });
  } catch (e) {
    console.error('[Settings] handleSheetsCreate error:', e);
    showToast('เกิดข้อผิดพลาด: ' + e.message, 3500);
    btnSheetsCreate.disabled = false;
  }
}

/**
 * Read the manually-entered Spreadsheet ID and persist it.
 */
function handleSheetsSaveId() {
  const id = sheetsIdEl.value.trim();
  if (!id) {
    showToast('กรุณากรอก Spreadsheet ID ก่อน', 2500);
    return;
  }

  chrome.storage.local.get(['config'], (items) => {
    if (chrome.runtime.lastError) {
      console.error('[Settings] handleSheetsSaveId storage get error:', chrome.runtime.lastError.message);
      return;
    }
    const config = { ...(items.config ?? {}), sheetsId: id };
    chrome.storage.local.set({ config }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Settings] handleSheetsSaveId storage set error:', chrome.runtime.lastError.message);
        return;
      }
      showToast('บันทึก Spreadsheet ID แล้ว ✓');
    });
  });
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Update checker
// ---------------------------------------------------------------------------

const GITHUB_REPO = 'Sittipanpee/LiveWatch';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
const ZIPBALL_URL   = `https://github.com/${GITHUB_REPO}/archive/refs/heads/main.zip`;

const currentVersionEl  = document.getElementById('currentVersion');
const lastCheckedLabelEl = document.getElementById('lastCheckedLabel');
const checkUpdateBtn    = document.getElementById('checkUpdateBtn');
const updateStatusEl    = document.getElementById('updateStatus');

/** Parse semver string into comparable integer, e.g. "1.2.3" → 10203 */
function parseSemver(v) {
  const parts = String(v).replace(/^v/, '').split('.').map(Number);
  return (parts[0] ?? 0) * 10000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0);
}

function initUpdateSection() {
  const manifest = chrome.runtime.getManifest();
  const current = manifest.version;
  currentVersionEl.textContent = `v${current}`;

  chrome.storage.local.get(['lastUpdateCheck'], (items) => {
    if (chrome.runtime.lastError) return;
    if (items.lastUpdateCheck) {
      const d = new Date(items.lastUpdateCheck);
      lastCheckedLabelEl.textContent = `ตรวจสอบล่าสุด: ${d.toLocaleDateString('th-TH')} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
    }
  });
}

function renderUpdateAvailable(latestTag, releaseNotes) {
  updateStatusEl.style.display = '';
  updateStatusEl.innerHTML = `
    <div style="background:#fef3c7;border:1.5px solid #f59e0b;border-radius:10px;padding:14px 16px;">
      <div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:6px;">
        🆕 มีเวอร์ชันใหม่: <span style="color:#d97706;">${latestTag}</span>
      </div>
      ${releaseNotes ? `<div style="font-size:12px;color:#78350f;margin-bottom:10px;white-space:pre-wrap;max-height:80px;overflow:auto;">${releaseNotes.slice(0, 300)}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="${ZIPBALL_URL}" download
           style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#f59e0b;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
          ⬇ ดาวน์โหลดอัพเดต (.zip)
        </a>
        <a href="${RELEASES_PAGE}" target="_blank"
           style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#fff;color:#92400e;border:1.5px solid #f59e0b;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
          ดูรายละเอียด
        </a>
      </div>
      <div style="margin-top:12px;font-size:12px;color:#78350f;background:#fffbeb;border-radius:8px;padding:10px 12px;line-height:1.8;">
        <strong>วิธีอัพเดต (3 ขั้นตอน):</strong><br>
        1. กดปุ่ม "ดาวน์โหลดอัพเดต" ด้านบน<br>
        2. แตกไฟล์ .zip ทับโฟลเดอร์เดิม (แทนที่ไฟล์ทั้งหมด)<br>
        3. เปิด <strong>chrome://extensions/</strong> แล้วกด 🔄 Reload ที่ TikTok Shop Helper
      </div>
    </div>`;
}

function renderUpToDate(latestTag) {
  updateStatusEl.style.display = '';
  updateStatusEl.innerHTML = `
    <div style="background:#d1fae5;border:1.5px solid #34d399;border-radius:10px;padding:12px 16px;font-size:13px;font-weight:600;color:#065f46;">
      ✓ ใช้เวอร์ชันล่าสุดอยู่แล้ว (${latestTag})
    </div>`;
}

function renderUpdateError(message) {
  updateStatusEl.style.display = '';
  updateStatusEl.innerHTML = `
    <div style="background:#fee2e2;border:1.5px solid #f87171;border-radius:10px;padding:12px 16px;font-size:13px;color:#991b1b;">
      ✗ ตรวจสอบไม่ได้: ${message}
    </div>`;
}

async function checkForUpdates() {
  checkUpdateBtn.disabled = true;
  checkUpdateBtn.textContent = 'กำลังตรวจสอบ...';
  updateStatusEl.style.display = 'none';

  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'Accept': 'application/vnd.github+json' },
    });

    const now = new Date().toISOString();
    chrome.storage.local.set({ lastUpdateCheck: now });
    lastCheckedLabelEl.textContent = `ตรวจสอบล่าสุด: เมื่อกี้นี้`;

    if (res.status === 404) {
      // No releases yet — repo is up to date by definition
      renderUpToDate('(ยังไม่มี release)');
      return;
    }

    if (!res.ok) {
      renderUpdateError(`GitHub ตอบกลับ ${res.status}`);
      return;
    }

    const data = await res.json();
    const latestTag = data.tag_name ?? '';
    const releaseNotes = data.body ?? '';
    const current = chrome.runtime.getManifest().version;

    if (!latestTag) {
      renderUpToDate('(ยังไม่มี release)');
      return;
    }

    if (parseSemver(latestTag) > parseSemver(current)) {
      renderUpdateAvailable(latestTag, releaseNotes);
    } else {
      renderUpToDate(latestTag);
    }
  } catch (err) {
    renderUpdateError(err.message);
  } finally {
    checkUpdateBtn.disabled = false;
    checkUpdateBtn.textContent = 'ตรวจสอบอัพเดต';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadApiConfig();
  initSheetsSection();
  initUpdateSection();
  applyTierConstraints();

  // Live range display
  captureIntervalEl.addEventListener('input', () => {
    captureIntervalDisplay.textContent = captureIntervalEl.value;
  });

  saveBtn.addEventListener('click', saveSettings);
  testPollinationsBtn.addEventListener('click', testPollinations);
  testApiBtn.addEventListener('click', testApiConnection);
  testSupabaseBtn.addEventListener('click', testSupabase);
  setupStorageBtn.addEventListener('click', setupStorageBucket);

  btnSheetsConnect.addEventListener('click', handleSheetsConnect);
  btnSheetsDisconnect.addEventListener('click', handleSheetsDisconnect);
  btnSheetsCreate.addEventListener('click', handleSheetsCreate);
  btnSheetsSaveId.addEventListener('click', handleSheetsSaveId);

  checkUpdateBtn.addEventListener('click', checkForUpdates);
});
